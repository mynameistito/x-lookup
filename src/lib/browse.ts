import { Effect, Result } from "effect";

import {
  DEFAULT_LIMIT,
  parseFeed,
  parseFormat,
  parseLimit,
  parsePage,
  parseResource,
  parseSearchQuery,
} from "./browse-query.js";
import type {
  BrowseFeed,
  BrowseFormat,
  BrowseLimit,
  BrowsePage,
  BrowseResource,
  InvalidBrowseFormat,
  InvalidBrowseResource,
  MissingSearchQuery,
} from "./browse-query.js";
import {
  Cache,
  buildCacheKey,
  cacheControlHeader,
  layerIsolateMemory,
} from "./cache.js";
import type { CacheStatus } from "./cache.js";
import { ConvertError } from "./errors.js";
import {
  fetchFxConnections,
  fetchFxProfile,
  fetchFxProfileStatuses,
  searchFxStatuses,
} from "./fxtwitter.js";
import type { FxAuthor, FxListResponse, FxTweet } from "./fxtwitter.js";
import type { HeaderMap, HttpPayload } from "./http.js";
import { parseBrowseFlag } from "./query-flag.js";
import { parse as parseXHandle } from "./x-handle.js";
import type { XHandle, InvalidXHandle } from "./x-handle.js";

/** Raw, untrusted browse query values exactly as they arrive from HTTP. */
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

/**
 * Which listing a browse request selects, with the values only that
 * selection needs. The tag doubles as the {@link BrowseResource}.
 */
export type BrowseSelection =
  | { readonly _tag: "followers"; readonly handle: XHandle }
  | { readonly _tag: "following"; readonly handle: XHandle }
  | { readonly _tag: "profile"; readonly handle: XHandle }
  | {
      readonly _tag: "search";
      readonly feed: BrowseFeed;
      readonly query: string;
    };

/** A fully parsed browse request: every value is domain-checked. */
export interface BrowseRequest {
  /** The opaque continuation cursor, when supplied. */
  readonly cursor: string | undefined;
  readonly format: BrowseFormat;
  /**
   * The `format` parameter verbatim, present only when the caller supplied
   * it. Continuation links must not grow a `format` value the caller never
   * sent, so the parsed default alone is not enough here.
   */
  readonly formatParam: string | undefined;
  /** Rich metrics flag, honoring the browse aliases (`1`/`true`). */
  readonly full: boolean;
  readonly limit: BrowseLimit;
  /** The `nocache` flag, honoring the browse aliases (`1`/`true`). */
  readonly nocache: boolean;
  readonly page: BrowsePage;
  readonly selection: BrowseSelection;
}

/** Every way parsing a browse request can fail. */
export type BrowseParseError =
  | InvalidBrowseFormat
  | InvalidBrowseResource
  | InvalidXHandle
  | MissingSearchQuery;

/** A browse failure: a parse refusal or an upstream provider failure. */
export type BrowseFailure = BrowseParseError | ConvertError;

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

/**
 * Parse the selection-specific values of a browse request.
 *
 * Search needs a non-empty trimmed `q` and a feed; every other selection
 * needs a strict handle. Values belonging to the other selection kind are
 * ignored, matching the historical behavior.
 */
const parseSelection = (
  resource: BrowseResource,
  input: BrowseInput
): Result.Result<BrowseSelection, BrowseParseError> => {
  if (resource === "search") {
    return Result.map(parseSearchQuery(input.q), (query): BrowseSelection => ({
      _tag: "search",
      feed: parseFeed(input.feed),
      query,
    }));
  }
  return Result.map(
    parseXHandle(input.handle ?? ""),
    (handle): BrowseSelection => ({ _tag: resource, handle })
  );
};

/**
 * Parse raw browse query values into a {@link BrowseRequest}.
 *
 * Parse order preserves the historical error precedence: resource, format,
 * then the selection-specific values (a strict handle for profile and graph
 * listings, a non-empty trimmed `q` for search).
 *
 * @param input - The raw query values.
 * @returns The parsed request, or the first parse refusal encountered.
 */
export const parseBrowseRequest = (
  input: BrowseInput
): Result.Result<BrowseRequest, BrowseParseError> =>
  Result.gen(function* parseRequest() {
    const resource = yield* parseResource(input.resource);
    const format = yield* parseFormat(input.format);
    const page = parsePage(input.page);
    const limit = parseLimit(input.limit);
    const full = parseBrowseFlag(input.full);
    const nocache = parseBrowseFlag(input.nocache);
    const selection = yield* parseSelection(resource, input);
    return {
      cursor: input.cursor ?? undefined,
      format,
      formatParam: input.format ?? undefined,
      full,
      limit,
      nocache,
      page,
      selection,
    };
  });

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
  request: BrowseRequest,
  result: Omit<BrowseResult, "markdown" | "cache">
): string | undefined => {
  if (!result.nextCursor) {
    return undefined;
  }
  const controls = new URLSearchParams();
  if (result.limit !== DEFAULT_LIMIT) {
    controls.set("limit", String(result.limit));
  }
  if (request.full) {
    controls.set("full", "true");
  }
  if (request.formatParam) {
    controls.set("format", request.formatParam);
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
  request: BrowseRequest,
  result: Omit<BrowseResult, "markdown" | "cache">
): string => {
  const { full } = request;
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
  const next = continuation(request, result);
  if (next) {
    lines.push("", next);
  }
  return `${lines.join("\n").trim()}\n`;
};

type BrowsePayload = Omit<BrowseResult, "cache">;

const browseUncached = async (
  request: BrowseRequest
): Promise<BrowsePayload> => {
  const { selection } = request;
  if (selection._tag === "search") {
    const list = await walkPages(request.page, request.cursor, (cursor) =>
      searchFxStatuses(selection.query, selection.feed, cursor, request.limit)
    );
    const base = {
      feed: selection.feed,
      limit: request.limit,
      nextCursor: list.cursor?.bottom,
      page: request.page,
      posts: list.results.slice(0, request.limit),
      query: selection.query,
      resource: selection._tag,
    };
    return { ...base, markdown: renderMarkdown(request, base) };
  }

  const { handle } = selection;
  if (selection._tag === "profile") {
    const [profile, list] = await Promise.all([
      fetchFxProfile(handle),
      walkPages(request.page, request.cursor, (cursor) =>
        fetchFxProfileStatuses(handle, cursor, request.limit)
      ),
    ]);
    const posts = list.results.filter(isOriginalPost).slice(0, request.limit);
    const base = {
      handle,
      limit: request.limit,
      nextCursor: list.cursor?.bottom,
      page: request.page,
      posts,
      profile,
      resource: selection._tag,
    };
    return { ...base, markdown: renderMarkdown(request, base) };
  }

  const list = await walkPages(request.page, request.cursor, (cursor) =>
    fetchFxConnections(handle, selection._tag, cursor, request.limit)
  );
  const base = {
    handle,
    limit: request.limit,
    nextCursor: list.cursor?.bottom,
    page: request.page,
    resource: selection._tag,
    users: list.results.slice(0, request.limit),
  };
  return { ...base, markdown: renderMarkdown(request, base) };
};

/**
 * Browse using the cache authority supplied through Effect.
 *
 * Only the cache seam is Effect-native here. The existing Promise-based browse
 * orchestration stays behind the loader bridge until the application-service
 * migration in the next issue.
 */
export const browseEffect = (
  input: BrowseInput
): Effect.Effect<Result.Result<BrowseResult, BrowseFailure>, never, Cache> =>
  Effect.gen(function* browseCached() {
    const parsed = parseBrowseRequest(input);
    if (Result.isFailure(parsed)) {
      return Result.fail(parsed.failure);
    }
    const request = parsed.success;
    const key = buildCacheKey({
      cursor: input.cursor ?? "",
      feed: input.feed ?? "",
      format: input.format ?? "markdown",
      full: request.full ? 1 : 0,
      handle: input.handle ?? "",
      limit: request.limit,
      page: request.page,
      q: input.q ?? "",
      resource: request.selection._tag,
      v: 2,
    });

    const cache = yield* Cache;
    const cached = yield* Effect.result(
      cache.getOrLoad(
        key,
        request.nocache,
        Effect.tryPromise({
          catch: (cause) => cause,
          try: () => browseUncached(request),
        })
      )
    );
    if (Result.isFailure(cached)) {
      if (cached.failure instanceof ConvertError) {
        return Result.fail(cached.failure);
      }
      return yield* Effect.die(cached.failure);
    }
    return Result.succeed({
      ...cached.success.value,
      cache: cached.success.status,
    });
  });

const defaultCacheLayer = layerIsolateMemory();

/** Temporary Promise bridge retained until browse orchestration migrates. */
export const browse = (
  input: BrowseInput
): Promise<Result.Result<BrowseResult, BrowseFailure>> =>
  Effect.runPromise(Effect.provide(browseEffect(input), defaultCacheLayer));

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
