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
import type { HeaderMap, HttpPayload } from "./http.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_PAGE = 10;

export type BrowseResource = "profile" | "search" | "followers" | "following";

type FlagValue = string | boolean | null;
type CountValue = string | number | null;

export interface BrowseInput {
  resource?: string | null;
  handle?: string | null;
  q?: string | null;
  feed?: string | null;
  cursor?: string | null;
  page?: CountValue;
  limit?: CountValue;
  full?: FlagValue;
  format?: string | null;
  nocache?: FlagValue;
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

const positiveInt = (
  value: CountValue | undefined,
  fallback: number
): number => {
  const parsed = Math.trunc(Number(String(value ?? "")));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const truthy = (value?: FlagValue): boolean =>
  value === true || value === "true" || value === "1";

const validHandle = (value?: string | null): string => {
  const handle = (value ?? "").replace(/^@/u, "");
  if (!/^[A-Za-z0-9_]{1,15}$/u.test(handle)) {
    throw new ConvertError(
      400,
      "A valid X handle is required.",
      "invalid_handle"
    );
  }
  return handle;
};

export const isOriginalPost = (post: FxTweet): boolean =>
  !post.replying_to && !post.replying_to_status?.length && !post.reposted_by;

const walkPages = <T>(
  page: number,
  cursor: string | undefined,
  fetchPage: (cursor?: string) => Promise<FxListResponse<T>>
): Promise<FxListResponse<T>> => {
  const walk = async (
    remaining: number,
    current: string | undefined
  ): Promise<FxListResponse<T>> => {
    const result = await fetchPage(current);
    if (remaining <= 1) {
      return result;
    }
    const next = result.cursor?.bottom;
    return next ? walk(remaining - 1, next) : { results: [] };
  };
  return walk(cursor ? 1 : page, cursor);
};

const postLine = (post: FxTweet, full: boolean): string => {
  const handle = post.author?.screen_name ?? "unknown";
  const profileUrl = `https://x.com/${handle}`;
  const url =
    post.url ??
    (post.id ? `https://x.com/${handle}/status/${post.id}` : profileUrl);
  const text = (post.text ?? "").replaceAll(/\s+/gu, " ").trim();
  const likes = post.likes ?? 0;
  const reposts = post.retweets ?? 0;
  const replies = post.replies ?? 0;
  const metrics = full
    ? ` — ${likes} likes, ${reposts} reposts, ${replies} replies`
    : "";
  const date = full && post.created_at ? ` (${post.created_at})` : "";
  return `- [@${handle}](${profileUrl}): ${text}${date}${metrics} [Source](${url})`;
};

const userLine = (user: FxAuthor, full: boolean): string => {
  const handle = user.screen_name ?? "unknown";
  const bio = user.description
    ? ` — ${user.description.replaceAll(/\s+/gu, " ")}`
    : "";
  const details = full ? ` — ${user.followers ?? 0} followers${bio}` : "";
  const displayName = user.name ?? `@${handle}`;
  return `- [${displayName} (@${handle})](https://x.com/${handle})${details}`;
};

const continuation = (
  input: BrowseInput,
  result: Omit<BrowseResult, "markdown" | "cache">
): string | undefined => {
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
    const suffix = result.resource === "profile" ? "" : `/${result.resource}`;
    path = `/${result.handle}${suffix}`;
  }
  const cursorParams = new URLSearchParams(controls);
  cursorParams.set("cursor", result.nextCursor);
  const pageParams = new URLSearchParams(controls);
  pageParams.set("page", String(result.page + 1));
  return `[Continue →](${path}?${cursorParams.toString()}) · [Next page (${result.page + 1}) →](${path}?${pageParams.toString()})`;
};

const renderMarkdown = (
  input: BrowseInput,
  result: Omit<BrowseResult, "markdown" | "cache">,
  full: boolean
): string => {
  const lines: string[] = [];
  if (result.resource === "profile" && result.profile) {
    const { profile } = result;
    const handle = profile.screen_name ?? result.handle ?? "unknown";
    const displayName = profile.name ?? `@${handle}`;
    lines.push(`# [${displayName} (@${handle})](https://x.com/${handle})`, "");
    if (profile.description) {
      lines.push(profile.description, "");
    }
    if (full) {
      lines.push(
        `Followers: ${profile.followers ?? 0} · Following: ${profile.following ?? 0} · Posts: ${profile.statuses ?? 0}`,
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
};

type BrowsePayload = Omit<BrowseResult, "cache">;

const browseUncached = async (
  input: BrowseInput,
  resource: BrowseResource,
  page: number,
  limit: number
): Promise<BrowsePayload> => {
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
};

export const browse = async (
  input: BrowseInput,
  config: RuntimeConfig = memoryConfig()
): Promise<BrowseResult> => {
  const { resource } = input;
  if (
    !resource ||
    !["profile", "search", "followers", "following"].includes(resource)
  ) {
    throw new ConvertError(
      400,
      "Unsupported browse resource.",
      "invalid_resource"
    );
  }
  // SAFETY: the includes() check above verified resource against the
  // BrowseResource union.
  const typedResource = resource as BrowseResource;
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
    resource: typedResource,
    v: 2,
  });
  const cached = await withCache(
    key,
    truthy(input.nocache),
    () => browseUncached(input, typedResource, page, limit),
    config
  );
  return { ...cached.value, cache: cached.status };
};

export const browseResponse = (
  result: BrowseResult,
  asJson: boolean
): HttpPayload => {
  const headers: HeaderMap = {
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
};
