import { Context, Effect, Layer, Result } from "effect";

import {
  parseFeed,
  parseFormat,
  parseLimit,
  parsePage,
  parseResource,
  parseSearchQuery,
} from "@/domain/browse-query.ts";
import type {
  BrowseFeed,
  BrowseFormat,
  BrowseLimit,
  BrowsePage,
  BrowseResource,
  InvalidBrowseFormat,
  InvalidBrowseResource,
  MissingSearchQuery,
} from "@/domain/browse-query.ts";
import { parseBrowseFlag } from "@/domain/query-flag.ts";
import { parse as parseXHandle } from "@/domain/x-handle.ts";
import type { InvalidXHandle, XHandle } from "@/domain/x-handle.ts";
import { Cache, buildCacheKey } from "@/infrastructure/cache/service.ts";
import type { CacheStatus } from "@/infrastructure/cache/service.ts";
import {
  MAX_BROWSE_PAGE_WALK,
  UpstreamWorkLimitError,
  browseUpstreamCalls,
  enforceUpstreamCallBudget,
} from "@/infrastructure/upstream-work-budget.ts";
import { FxTwitter } from "@/providers/contracts.ts";
import type { FxTwitterFailure } from "@/providers/errors.ts";
import type {
  FxAuthor,
  FxListResponse,
  FxTweet,
} from "@/providers/fxtwitter/types.ts";

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

/** A browse failure: a parse refusal or an FxTwitter provider failure. */
export type BrowseFailure =
  | BrowseParseError
  | FxTwitterFailure
  | UpstreamWorkLimitError;

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
  cache: CacheStatus;
}

export interface BrowseService {
  readonly browse: (
    request: BrowseRequest
  ) => Effect.Effect<BrowseResult, FxTwitterFailure | UpstreamWorkLimitError>;
}

/** Owns profile/search/social-graph page walking and cache orchestration. */
export class Browse extends Context.Service<Browse, BrowseService>()(
  "x-lookup/application/Browse"
) {}

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

const walkPages = <T, E>(
  page: number,
  cursor: string | undefined,
  fetchPage: (cursor?: string) => Effect.Effect<FxListResponse<T>, E>
): Effect.Effect<FxListResponse<T>, E> => {
  const walk = (
    remaining: number,
    current: string | undefined
  ): Effect.Effect<FxListResponse<T>, E> =>
    Effect.gen(function* walkPage() {
      const result = yield* fetchPage(current);
      if (remaining <= 1) {
        return result;
      }
      const next = result.cursor?.bottom;
      return next ? yield* walk(remaining - 1, next) : { results: [] };
    });
  return walk(cursor ? 1 : page, cursor);
};

const makeBrowse = Effect.gen(function* makeBrowseService() {
  const cache = yield* Cache;
  const fxTwitter = yield* FxTwitter;

  const browseUncached = Effect.fn("Browse.loadUncached")(
    function* browseUncachedEffect(request: BrowseRequest) {
      const { selection } = request;
      const budgetError = enforceUpstreamCallBudget(
        "browse",
        browseUpstreamCalls(
          request.page,
          request.cursor !== undefined,
          selection._tag === "profile"
        )
      );
      if (budgetError) {
        return yield* Effect.fail(budgetError);
      }
      if (!request.cursor && request.page > MAX_BROWSE_PAGE_WALK) {
        return yield* Effect.fail(
          new UpstreamWorkLimitError({
            limit: MAX_BROWSE_PAGE_WALK,
            operation: "browse",
            requested: request.page,
          })
        );
      }
      if (selection._tag === "search") {
        const list = yield* walkPages(request.page, request.cursor, (cursor) =>
          fxTwitter.searchStatuses(
            selection.query,
            selection.feed,
            cursor,
            request.limit
          )
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
        return base;
      }

      const { handle } = selection;
      if (selection._tag === "profile") {
        const [profile, list] = yield* Effect.all(
          [
            fxTwitter.fetchProfile(handle),
            walkPages(request.page, request.cursor, (cursor) =>
              fxTwitter.fetchProfileStatuses(handle, cursor, request.limit)
            ),
          ],
          { concurrency: "unbounded" }
        );
        const posts = list.results
          .filter(isOriginalPost)
          .slice(0, request.limit);
        const base = {
          handle,
          limit: request.limit,
          nextCursor: list.cursor?.bottom,
          page: request.page,
          posts,
          profile,
          resource: selection._tag,
        };
        return base;
      }

      const list = yield* walkPages(request.page, request.cursor, (cursor) =>
        fxTwitter.fetchConnections(
          handle,
          selection._tag,
          cursor,
          request.limit
        )
      );
      const base = {
        handle,
        limit: request.limit,
        nextCursor: list.cursor?.bottom,
        page: request.page,
        resource: selection._tag,
        users: list.results.slice(0, request.limit),
      };
      return base;
    }
  );

  const browse = Effect.fn("Browse.browse")(function* browseEffect(
    request: BrowseRequest
  ) {
    const { selection } = request;
    const key = buildCacheKey({
      cursor: request.cursor ?? "",
      feed: selection._tag === "search" ? selection.feed : "",
      format: request.formatParam ?? request.format,
      full: request.full ? 1 : 0,
      handle: selection._tag === "search" ? "" : selection.handle,
      limit: request.limit,
      page: request.page,
      q: selection._tag === "search" ? selection.query : "",
      resource: selection._tag,
      v: 2,
    });
    const cached = yield* cache.getOrLoad(
      key,
      request.nocache,
      browseUncached(request)
    );
    return { ...cached.value, cache: cached.status };
  });

  return Browse.of({ browse });
});

/** Dependency-preserving application Layer; composition chooses Cache/FxTwitter. */
export const layerBrowseWithoutDependencies = Layer.effect(Browse, makeBrowse);

/** Invoke browse orchestration with an already-parsed boundary value. */
export const browseRequestEffect = (
  request: BrowseRequest
): Effect.Effect<
  BrowseResult,
  FxTwitterFailure | UpstreamWorkLimitError,
  Browse
> => Browse.use((service) => service.browse(request));

/** Raw-input compatibility helper for non-HTTP callers and focused parser tests. */
export const browseEffect = (
  input: BrowseInput
): Effect.Effect<BrowseResult, BrowseFailure, Browse> =>
  Effect.gen(function* browseFromRawInput() {
    const parsed = parseBrowseRequest(input);
    if (Result.isFailure(parsed)) {
      return yield* Effect.fail(parsed.failure);
    }
    return yield* browseRequestEffect(parsed.success);
  });
