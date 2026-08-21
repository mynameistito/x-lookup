import {
  buildCacheKey,
  cacheControlHeader,
  memoryConfig,
  withCache,
} from "./cache.js";
import type { CacheStatus, RuntimeConfig } from "./cache.js";
import { ConvertError } from "./errors.js";
import {
  fetchFxConnections,
  fetchFxProfile,
  fetchFxProfileStatuses,
  searchFxStatuses,
} from "./fxtwitter.js";
import type { FxAuthor, FxListResponse, FxTweet } from "./fxtwitter.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_PAGE = 10;

export type BrowseResource = "profile" | "search" | "followers" | "following";

export interface BrowseInput {
  resource?: string | null;
  handle?: string | null;
  q?: string | null;
  feed?: string | null;
  cursor?: string | null;
  page?: string | number | null;
  limit?: string | number | null;
  full?: string | boolean | null;
  format?: string | null;
  nocache?: string | boolean | null;
}

export interface BrowseResult {
  resource: BrowseResource;
  profile?: FxAuthor;
  posts?: FxTweet[];
  users?: FxAuthor[];
  query?: string;
  feed?: string;
  handle?: string;
  page: number;
  limit: number;
  nextCursor?: string;
  markdown: string;
  cache: CacheStatus;
}

function positiveInt(
  value: string | number | null | undefined,
  fallback: number
): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function truthy(value: string | boolean | null | undefined): boolean {
  return value === true || value === "true" || value === "1";
}

function validHandle(value: string | null | undefined): string {
  const handle = (value ?? "").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    throw new ConvertError(
      400,
      "A valid X handle is required.",
      "invalid_handle"
    );
  }
  return handle;
}

export function isOriginalPost(post: FxTweet): boolean {
  return (
    !post.replying_to && !post.replying_to_status?.length && !post.reposted_by
  );
}

async function walkPages<T>(
  page: number,
  cursor: string | undefined,
  fetchPage: (cursor?: string) => Promise<FxListResponse<T>>
): Promise<FxListResponse<T>> {
  let current = cursor;
  let result: FxListResponse<T> = { results: [] };
  const walks = cursor ? 1 : page;
  for (let index = 0; index < walks; index += 1) {
    result = await fetchPage(current);
    if (index < walks - 1) {
      current = result.cursor?.bottom;
      if (!current) {
        return { results: [] };
      }
    }
  }
  return result;
}

function postLine(post: FxTweet, full: boolean): string {
  const handle = post.author?.screen_name ?? "unknown";
  const url =
    post.url ??
    (post.id
      ? `https://x.com/${handle}/status/${post.id}`
      : `https://x.com/${handle}`);
  const text = (post.text ?? "").replaceAll(/\s+/g, " ").trim();
  const metrics = full
    ? ` — ${post.likes ?? 0} likes, ${post.retweets ?? 0} reposts, ${post.replies ?? 0} replies`
    : "";
  const date = full && post.created_at ? ` (${post.created_at})` : "";
  return `- [@${handle}](${`https://x.com/${handle}`}): ${text}${date}${metrics} [Source](${url})`;
}

function userLine(user: FxAuthor, full: boolean): string {
  const handle = user.screen_name ?? "unknown";
  const details = full
    ? ` — ${user.followers ?? 0} followers${user.description ? ` — ${user.description.replaceAll(/\s+/g, " ")}` : ""}`
    : "";
  return `- [${user.name ?? `@${handle}`} (@${handle})](https://x.com/${handle})${details}`;
}

function continuation(
  input: BrowseInput,
  result: Omit<BrowseResult, "markdown" | "cache">
): string | undefined {
  if (!result.nextCursor) {
    return undefined;
  }
  const controls = new URLSearchParams();
  if (result.limit !== DEFAULT_LIMIT) {
    controls.set("limit", String(result.limit));
  }
  if (truthy(input.full)) {
    controls.set("full", "true");
  }
  if (input.format) {
    controls.set("format", input.format);
  }
  let path: string;
  if (result.resource === "search") {
    controls.set("q", result.query ?? "");
    if (result.feed) {
      controls.set("feed", result.feed);
    }
    path = "/search";
  } else {
    path = `/${result.handle}${result.resource === "profile" ? "" : `/${result.resource}`}`;
  }
  const cursorParams = new URLSearchParams(controls);
  cursorParams.set("cursor", result.nextCursor);
  const pageParams = new URLSearchParams(controls);
  pageParams.set("page", String(result.page + 1));
  return `[Continue →](${path}?${cursorParams.toString()}) · [Next page (${result.page + 1}) →](${path}?${pageParams.toString()})`;
}

function renderMarkdown(
  input: BrowseInput,
  result: Omit<BrowseResult, "markdown" | "cache">,
  full: boolean
): string {
  const lines: string[] = [];
  if (result.resource === "profile" && result.profile) {
    const p = result.profile;
    const handle = p.screen_name ?? result.handle ?? "unknown";
    lines.push(
      `# [${p.name ?? `@${handle}`} (@${handle})](https://x.com/${handle})`,
      ""
    );
    if (p.description) {
      lines.push(p.description, "");
    }
    if (full) {
      lines.push(
        `Followers: ${p.followers ?? 0} · Following: ${p.following ?? 0} · Posts: ${p.statuses ?? 0}`,
        ""
      );
    }
    lines.push(
      "## Latest posts",
      ...(result.posts ?? []).map((post) => postLine(post, full))
    );
  } else if (result.resource === "search") {
    lines.push(
      `# X search: ${result.query}`,
      "",
      ...(result.posts ?? []).map((post) => postLine(post, full))
    );
  } else {
    lines.push(
      `# @${result.handle} ${result.resource}`,
      "",
      ...(result.users ?? []).map((user) => userLine(user, full))
    );
  }
  const next = continuation(input, result);
  if (next) {
    lines.push("", next);
  }
  return `${lines.join("\n").trim()}\n`;
}

type BrowsePayload = Omit<BrowseResult, "cache">;

async function browseUncached(
  input: BrowseInput,
  resource: BrowseResource,
  page: number,
  limit: number
): Promise<BrowsePayload> {
  const full = truthy(input.full);
  if (resource === "search") {
    const query = input.q?.trim();
    if (!query) {
      throw new ConvertError(
        400,
        "Search query q is required.",
        "missing_query"
      );
    }
    const feed = ["latest", "top", "media"].includes(input.feed ?? "")
      ? String(input.feed)
      : "latest";
    const list = await walkPages(page, input.cursor ?? undefined, (cursor) =>
      searchFxStatuses(query, feed, cursor, limit)
    );
    const base = {
      feed,
      limit,
      nextCursor: list.cursor?.bottom,
      page,
      posts: list.results.slice(0, limit),
      query,
      resource,
    };
    return { ...base, markdown: renderMarkdown(input, base, full) };
  }

  const handle = validHandle(input.handle);
  if (resource === "profile") {
    const [profile, list] = await Promise.all([
      fetchFxProfile(handle),
      walkPages(page, input.cursor ?? undefined, (cursor) =>
        fetchFxProfileStatuses(handle, cursor, limit)
      ),
    ]);
    const posts = list.results.filter(isOriginalPost).slice(0, limit);
    const base = {
      handle,
      limit,
      nextCursor: list.cursor?.bottom,
      page,
      posts,
      profile,
      resource,
    };
    return { ...base, markdown: renderMarkdown(input, base, full) };
  }

  const list = await walkPages(page, input.cursor ?? undefined, (cursor) =>
    fetchFxConnections(handle, resource, cursor, limit)
  );
  const base = {
    handle,
    limit,
    nextCursor: list.cursor?.bottom,
    page,
    resource,
    users: list.results.slice(0, limit),
  };
  return { ...base, markdown: renderMarkdown(input, base, full) };
}

export async function browse(
  input: BrowseInput,
  config: RuntimeConfig = memoryConfig()
): Promise<BrowseResult> {
  const resource = input.resource as BrowseResource;
  if (!["profile", "search", "followers", "following"].includes(resource)) {
    throw new ConvertError(
      400,
      "Unsupported browse resource.",
      "invalid_resource"
    );
  }
  if (input.format && input.format !== "markdown" && input.format !== "json") {
    throw new ConvertError(
      400,
      "Browse `format` must be `markdown` or `json`.",
      "invalid_format"
    );
  }
  const page = Math.min(positiveInt(input.page, 1), MAX_PAGE);
  const limit = Math.min(positiveInt(input.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const key = buildCacheKey({
    cursor: input.cursor ?? "",
    feed: input.feed ?? "",
    format: input.format ?? "markdown",
    full: truthy(input.full) ? 1 : 0,
    handle: input.handle ?? "",
    limit,
    page,
    q: input.q ?? "",
    resource,
    v: 2,
  });
  const cached = await withCache(
    key,
    truthy(input.nocache),
    () => browseUncached(input, resource, page, limit),
    config
  );
  return { ...cached.value, cache: cached.status };
}

export function browseResponse(
  result: BrowseResult,
  asJson: boolean
): { status: number; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {
    "Content-Type": asJson
      ? "application/json; charset=utf-8"
      : "text/markdown; charset=utf-8",
    Vary: "Accept",
    "X-Browse-Resource": result.resource,
    "X-Cache": result.cache.toUpperCase(),
    "X-Result-Count": String(result.posts?.length ?? result.users?.length ?? 0),
    "X-Source": "fxtwitter",
  };
  if (result.cache !== "bypass") {
    headers["Cache-Control"] = cacheControlHeader();
  }
  return {
    body: asJson ? JSON.stringify(result) : result.markdown,
    headers,
    status: 200,
  };
}
