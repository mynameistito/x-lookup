import { Context, Effect, Layer, Result } from "effect";

import { PostLookup } from "@/application/post-lookup.ts";
import type {
  FetchSource,
  PostLookupFailure,
} from "@/application/post-lookup.ts";
import {
  parseContext,
  parseReplies,
  parseUserinfo,
} from "@/domain/conversion-query.ts";
import type {
  ContextMode,
  InvalidContext,
  InvalidReplies,
  InvalidUserinfo,
  RepliesMode,
  UserinfoLevel,
} from "@/domain/conversion-query.ts";
import { parse as parseOutputFormat } from "@/domain/output-format.ts";
import type {
  InvalidOutputFormat,
  OutputFormat,
} from "@/domain/output-format.ts";
import { parseConvertFlag } from "@/domain/query-flag.ts";
import { resolve } from "@/domain/status-target.ts";
import type { ResolveError, StatusTarget } from "@/domain/status-target.ts";
import { parse as parseThreadSelection } from "@/domain/thread-selection.ts";
import type {
  InvalidThread,
  ThreadSelection,
} from "@/domain/thread-selection.ts";
import { Cache, buildCacheKey } from "@/infrastructure/cache/service.ts";
import type { CacheStatus } from "@/infrastructure/cache/service.ts";
import { enforceUpstreamCallBudget } from "@/infrastructure/upstream-work-budget.ts";
import type { UpstreamWorkLimitError } from "@/infrastructure/upstream-work-budget.ts";
import type { FxTweet } from "@/providers/fxtwitter/types.ts";

/** Raw, untrusted convert query values exactly as they arrive from HTTP. */
export interface ConvertInput {
  url?: string | null;
  handle?: string | null;
  id?: string | null;
  format?: string | null;
  thread?: string | null;
  userinfo?: string | null;
  nocache?: boolean | string | null;
  full?: boolean | string | null;
  context?: string | null;
  replies?: string | null;
}

/** A fully parsed convert request: every value is domain-checked. */
export interface ConvertRequest {
  /** Rich rendering is on unless the `full` flag is falsy. */
  readonly compact: boolean;
  readonly context: ContextMode;
  readonly format: OutputFormat;
  /** The `nocache` flag, honoring the convert aliases (`1`/`true`/`yes`). */
  readonly nocache: boolean;
  readonly replies: RepliesMode;
  readonly target: StatusTarget;
  readonly thread: ThreadSelection;
  readonly userinfo: UserinfoLevel;
}

/** Every way parsing a convert request can fail. */
export type ConvertParseError =
  | InvalidContext
  | InvalidOutputFormat
  | InvalidReplies
  | InvalidThread
  | InvalidUserinfo
  | ResolveError;

/** A convert failure: a parse refusal or a typed post/provider failure. */
export type ConvertFailure =
  | ConvertParseError
  | PostLookupFailure
  | UpstreamWorkLimitError;

export interface ConvertSuccess {
  warnings: string[];
  canonicalUrl: string;
  format: OutputFormat;
  postCount: number;
  source: FetchSource;
  cache: CacheStatus;
  posts: FxTweet[];
  compact: boolean;
  userinfo: UserinfoLevel;
}

export interface ConversionService {
  readonly convert: (
    request: ConvertRequest
  ) => Effect.Effect<
    ConvertSuccess,
    PostLookupFailure | UpstreamWorkLimitError
  >;
}

/** Owns parsed conversion policy, post lookup, caching, truncation, and metadata. */
export class Conversion extends Context.Service<
  Conversion,
  ConversionService
>()("x-lookup/application/Conversion") {}

/**
 * Parse raw convert query values into a {@link ConvertRequest}.
 *
 * Parse order preserves the historical error precedence: format, thread,
 * userinfo, flags, context, replies, then the status target.
 */
export const parseConvertRequest = (
  input: ConvertInput
): Result.Result<ConvertRequest, ConvertParseError> =>
  Result.gen(function* parseRequest() {
    const format = yield* parseOutputFormat(input.format);
    const thread = yield* parseThreadSelection(input.thread);
    const userinfo = yield* parseUserinfo(input.userinfo);
    const nocache = parseConvertFlag(input.nocache);
    const compact = !parseConvertFlag(input.full);
    const context = yield* parseContext(input.context);
    const replies = yield* parseReplies(input.replies);
    const target = yield* resolve(input);
    return {
      compact,
      context,
      format,
      nocache,
      replies,
      target,
      thread,
      userinfo,
    };
  });

const withSourceUrls = (tweet: FxTweet, fallback?: string): FxTweet => {
  const handle = tweet.author?.screen_name;
  const url =
    tweet.url ??
    (handle && tweet.id
      ? `https://x.com/${handle}/status/${tweet.id}`
      : fallback);
  return {
    ...tweet,
    quote: tweet.quote ? withSourceUrls(tweet.quote) : undefined,
    url,
  };
};

const limitPostsByRole = (
  posts: FxTweet[],
  requestedId: string,
  limit: number
): FxTweet[] => {
  if (posts.length <= limit) {
    return posts;
  }
  const priorityFor = (post: FxTweet): number => {
    if (post.id === requestedId) {
      return 0;
    }
    return post.context === "parent" || post.context === "thread" ? 1 : 2;
  };
  const focalIndex = posts.findIndex((post) => post.id === requestedId);
  const candidates = posts.map((post, index) => ({
    index,
    post,
    priority: priorityFor(post),
  }));
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Closest parent first; continuations and ranked replies retain provider order.
    if (a.post.context === "parent" && b.post.context === "parent") {
      return Math.abs(focalIndex - a.index) - Math.abs(focalIndex - b.index);
    }
    return a.index - b.index;
  });
  const selected = new Set(
    candidates.slice(0, limit).map(({ index }) => index)
  );
  return posts.filter((_post, index) => selected.has(index));
};

type ConvertPayload = Omit<ConvertSuccess, "cache">;

const makeConversion = Effect.gen(function* makeConversionService() {
  const cache = yield* Cache;
  const postLookup = yield* PostLookup;

  const convertUncached = Effect.fn("Conversion.loadUncached")(
    function* convertUncachedEffect(request: ConvertRequest) {
      const warnings: string[] = [];
      const budgetError = enforceUpstreamCallBudget(
        "convert",
        request.thread._tag === "off" || request.replies === "off" ? 2 : 3
      );
      if (budgetError) {
        return yield* Effect.fail(budgetError);
      }
      const { compact, context, format, replies, target, thread, userinfo } =
        request;
      const { canonicalUrl, handle, id } = target;
      const fetched = yield* postLookup.lookup({
        context,
        handle,
        id,
        replies,
        thread: thread._tag,
      });

      let posts = fetched.tweets;
      if (thread._tag === "full" && posts.length > thread.limit) {
        posts = limitPostsByRole(posts, id, thread.limit);
        warnings.push(`Thread truncated to ${thread.limit} posts.`);
      }
      posts = posts.map((post) =>
        withSourceUrls(
          post,
          post.id === id || posts.length === 1 ? canonicalUrl : undefined
        )
      );

      if (fetched.source !== "fxtwitter") {
        warnings.push(
          `Fetched via ${fetched.source} fallback — threads, full articles, and quotes may be limited.`
        );
      }

      return {
        canonicalUrl,
        compact: compact && format !== "obsidian",
        format,
        postCount: posts.length,
        posts,
        source: fetched.source,
        userinfo,
        warnings,
      } satisfies ConvertPayload;
    }
  );

  const convert = Effect.fn("Conversion.convert")(function* convertEffect(
    request: ConvertRequest
  ) {
    const cacheKey = buildCacheKey({
      compact: request.compact ? "1" : "0",
      context: request.context,
      format: request.format,
      handle: request.target.handle.toLowerCase(),
      id: request.target.id,
      replies: request.replies,
      thread: request.thread.cacheToken,
      userinfo: request.userinfo,
      v: 5,
    });
    const cached = yield* cache.getOrLoad(
      cacheKey,
      request.nocache,
      convertUncached(request)
    );
    return { ...cached.value, cache: cached.status };
  });

  return Conversion.of({ convert });
});

/** Dependency-preserving application Layer; composition chooses Cache/PostLookup. */
export const layerConversionWithoutDependencies = Layer.effect(
  Conversion,
  makeConversion
);

/** Invoke conversion orchestration with an already-parsed boundary value. */
export const convertRequestEffect = (
  request: ConvertRequest
): Effect.Effect<
  ConvertSuccess,
  PostLookupFailure | UpstreamWorkLimitError,
  Conversion
> => Conversion.use((service) => service.convert(request));

/** Raw-input compatibility helper for non-HTTP callers and focused parser tests. */
export const convertTweetEffect = (
  input: ConvertInput
): Effect.Effect<ConvertSuccess, ConvertFailure, Conversion> =>
  Effect.gen(function* convertTweetFromRawInput() {
    const parsed = parseConvertRequest(input);
    if (Result.isFailure(parsed)) {
      return yield* Effect.fail(parsed.failure);
    }
    return yield* convertRequestEffect(parsed.success);
  });
