import { Context, Effect, Layer, Result } from "effect";

import type { FxReplyRanking, FxTweet } from "@/lib/fxtwitter-types.ts";
import type { PostId } from "@/lib/post-id.ts";
import type {
  FxTwitterFailure,
  SyndicationFailure,
} from "@/lib/provider-errors.ts";
import { FxTwitter, Syndication } from "@/lib/provider-service.ts";
import type { ContextMode, RepliesMode } from "@/lib/query-modes.ts";

export type FetchSource = "fxtwitter" | "syndication";

export interface FetchResult {
  readonly tweets: FxTweet[];
  readonly source: FetchSource;
}

export interface PostLookupInput {
  readonly context: ContextMode;
  readonly handle: string;
  readonly id: PostId;
  readonly replies: RepliesMode;
  readonly thread: "off" | "full";
}

export type PostLookupFailure = FxTwitterFailure | SyndicationFailure;

export interface PostLookupService {
  readonly lookup: (
    input: PostLookupInput
  ) => Effect.Effect<FetchResult, PostLookupFailure>;
}

/** Owns provider fallback plus status/thread/reply assembly policy. */
export class PostLookup extends Context.Service<
  PostLookup,
  PostLookupService
>()("x-lookup/application/PostLookup") {}

const annotateAndDedupe = (
  thread: FxTweet[],
  requestedId: string,
  replies: FxTweet[]
): FxTweet[] => {
  const requestedIndex = thread.findIndex((tweet) => tweet.id === requestedId);
  const seen = new Set<string>();
  const output: FxTweet[] = [];
  const add = (tweet: FxTweet, context: FxTweet["context"]) => {
    if (tweet.id && seen.has(tweet.id)) {
      return;
    }
    if (tweet.id) {
      seen.add(tweet.id);
    }
    output.push({ ...tweet, context });
  };
  const contextFor = (tweet: FxTweet, index: number): FxTweet["context"] => {
    if (tweet.id === requestedId) {
      return "post";
    }
    return requestedIndex !== -1 && index < requestedIndex
      ? "parent"
      : "thread";
  };

  for (const [index, tweet] of thread.entries()) {
    add(tweet, contextFor(tweet, index));
  }
  for (const tweet of replies) {
    add(tweet, "reply");
  }
  return output;
};

const focalAuthorThread = (
  thread: FxTweet[],
  requestedId: string,
  requestedHandle: string
): FxTweet[] => {
  const focal = thread.find((tweet) => tweet.id === requestedId);
  const authorId = focal?.author?.id;
  const handle =
    focal?.author?.screen_name?.toLowerCase() ?? requestedHandle.toLowerCase();
  return thread.filter((tweet) => {
    if (tweet.id === requestedId) {
      return true;
    }
    if (authorId) {
      return tweet.author?.id === authorId;
    }
    return Boolean(
      handle && tweet.author?.screen_name?.toLowerCase() === handle
    );
  });
};

const isPrivateTweet = (
  failure: PostLookupFailure
): failure is Extract<
  PostLookupFailure,
  { readonly _tag: "FxTwitterPrivateTweetError" }
> => failure._tag === "FxTwitterPrivateTweetError";

const makePostLookup = Effect.gen(function* makePostLookupService() {
  const fxTwitter = yield* FxTwitter;
  const syndication = yield* Syndication;

  const fetchStatusWithFallback = Effect.fn(
    "PostLookup.fetchStatusWithFallback"
  )(function* fetchStatusWithFallbackEffect(handle: string, id: string) {
    const fxResult = yield* Effect.result(fxTwitter.fetchStatus(id));
    if (Result.isSuccess(fxResult)) {
      return {
        source: "fxtwitter" as const,
        tweets: [fxResult.success],
      };
    }
    if (isPrivateTweet(fxResult.failure)) {
      return yield* Effect.fail(fxResult.failure);
    }

    const syndicationResult = yield* Effect.result(
      syndication.fetchStatus(handle, id)
    );
    if (Result.isSuccess(syndicationResult)) {
      return {
        source: "syndication" as const,
        tweets: [syndicationResult.success],
      };
    }

    // Preserve the first truthful not-found verdict over later upstream
    // failures; otherwise the final classified provider failure wins.
    if (fxResult.failure.status === 404) {
      return yield* Effect.fail(fxResult.failure);
    }
    if (syndicationResult.failure.status === 404) {
      return yield* Effect.fail(syndicationResult.failure);
    }
    return yield* Effect.fail(syndicationResult.failure);
  });

  const lookup = Effect.fn("PostLookup.lookup")(function* lookupEffect(
    input: PostLookupInput
  ) {
    const { context, handle, id, replies, thread } = input;
    if (thread === "off") {
      const result = yield* fetchStatusWithFallback(handle, id);
      return {
        ...result,
        tweets: annotateAndDedupe(result.tweets, id, []),
      };
    }

    const threadResult = yield* Effect.result(fxTwitter.fetchFullThread(id));
    if (Result.isSuccess(threadResult)) {
      const assembledThread =
        context === "thread"
          ? focalAuthorThread(threadResult.success, id, handle)
          : threadResult.success;
      if (replies === "off" || context === "thread") {
        return {
          source: "fxtwitter" as const,
          tweets: annotateAndDedupe(assembledThread, id, []),
        };
      }

      const ranking: FxReplyRanking =
        replies === "recent" ? "recency" : "likes";
      const replyResult = yield* Effect.result(
        fxTwitter.fetchConversationReplies(id, ranking, 10)
      );
      const replyTweets = Result.isSuccess(replyResult)
        ? replyResult.success
        : [];
      return {
        source: "fxtwitter" as const,
        tweets: annotateAndDedupe(assembledThread, id, replyTweets),
      };
    }

    if (isPrivateTweet(threadResult.failure)) {
      return yield* Effect.fail(threadResult.failure);
    }

    const fallback = yield* fetchStatusWithFallback(handle, id);
    return {
      ...fallback,
      tweets: annotateAndDedupe(fallback.tweets, id, []),
    };
  });

  return PostLookup.of({ lookup });
});

export const layerPostLookupWithoutDependencies = Layer.effect(
  PostLookup,
  makePostLookup
);

export const fetchPostsEffect = (
  handle: string,
  id: PostId,
  thread: "off" | "full",
  context: ContextMode = "full",
  replies: RepliesMode = "top"
): Effect.Effect<FetchResult, PostLookupFailure, PostLookup> =>
  PostLookup.use((service) =>
    service.lookup({ context, handle, id, replies, thread })
  );
