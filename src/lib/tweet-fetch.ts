import { Effect } from "effect";

import {
  fetchFxConversationReplies,
  fetchFxFullThread,
  fetchFxStatus,
} from "./fxtwitter.js";
import type { FxReplyRanking, FxTweet } from "./fxtwitter.js";
import type { PostId } from "./post-id.js";
import type { ProviderFailure } from "./provider-errors.js";
import { runProviderEffect } from "./provider-http.js";
import type { ProviderEffect } from "./provider-http.js";
import type { ContextMode, RepliesMode } from "./query-modes.js";
import { fetchSyndicationStatus } from "./syndication.js";

export type FetchSource = "fxtwitter" | "syndication";

export interface FetchResult {
  tweets: FxTweet[];
  source: FetchSource;
}

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

/** Free providers only: FxTwitter first, then Twitter's syndication endpoint. */
const fetchStatusWithFallback = (
  handle: string,
  id: string
): ProviderEffect<FetchResult, ProviderFailure> => {
  const attempts: ReadonlyArray<
    ProviderEffect<FetchResult, ProviderFailure>
  > = [
    fetchFxStatus(id).pipe(
      Effect.map((tweet) => ({ source: "fxtwitter" as const, tweets: [tweet] }))
    ),
    fetchSyndicationStatus(handle, id).pipe(
      Effect.map((tweet) => ({ source: "syndication" as const, tweets: [tweet] }))
    ),
  ];

  const run = (
    index: number,
    notFound?: ProviderFailure,
    lastError?: ProviderFailure
  ): ProviderEffect<FetchResult, ProviderFailure> => {
    const attempt = attempts[index];
    if (!attempt) {
      if (notFound) {
        return Effect.fail(notFound);
      }
      if (lastError) {
        return Effect.fail(lastError);
      }
      return Effect.dieMessage("Provider fallback exhausted without an attempt");
    }

    return attempt.pipe(
      Effect.catch((error) => {
        if (error.code === "private_tweet") {
          return Effect.fail(error);
        }
        // Prefer a truthful "missing" verdict from any provider over later
        // upstream failures when everything else failed.
        const nextNotFound =
          notFound ?? (error.status === 404 ? error : undefined);
        return run(index + 1, nextNotFound, error);
      })
    );
  };

  return run(0);
};

/**
 * Effect-native fetch policy for a resolved status target.
 *
 * The policy is intentionally unchanged: FxTwitter is authoritative first,
 * syndication is the single-status fallback, private posts short-circuit, and
 * reply context remains additive.
 */
export const fetchPostsEffect = (
  handle: string,
  id: PostId,
  threadMode: "off" | "full",
  contextMode: ContextMode = "full",
  repliesMode: RepliesMode = "top"
): ProviderEffect<FetchResult, ProviderFailure> => {
  if (threadMode === "off") {
    return fetchStatusWithFallback(handle, id).pipe(
      Effect.map((result) => ({
        ...result,
        tweets: annotateAndDedupe(result.tweets, id, []),
      }))
    );
  }

  const fromFxTwitter = Effect.gen(function* () {
    const assembledThread = yield* fetchFxFullThread(id);
    const thread =
      contextMode === "thread"
        ? focalAuthorThread(assembledThread, id, handle)
        : assembledThread;
    if (repliesMode === "off" || contextMode === "thread") {
      return {
        source: "fxtwitter" as const,
        tweets: annotateAndDedupe(thread, id, []),
      };
    }

    const ranking: FxReplyRanking =
      repliesMode === "recent" ? "recency" : "likes";
    const replies = yield* fetchFxConversationReplies(id, ranking, 10).pipe(
      Effect.catch(() => Effect.succeed<FxTweet[]>([]))
    );
    return {
      source: "fxtwitter" as const,
      tweets: annotateAndDedupe(thread, id, replies),
    };
  });

  return fromFxTwitter.pipe(
    Effect.catch((error) =>
      error.code === "private_tweet"
        ? Effect.fail(error)
        : fetchStatusWithFallback(handle, id).pipe(
            Effect.map((result) => ({
              ...result,
              tweets: annotateAndDedupe(result.tweets, id, []),
            }))
          )
    )
  );
};

/**
 * Promise-facing compatibility entrypoint used by the existing cache/rendering
 * application layer. Provider I/O itself remains inside the typed Effect.
 */
export const fetchPosts = (
  handle: string,
  id: PostId,
  threadMode: "off" | "full",
  contextMode: ContextMode = "full",
  repliesMode: RepliesMode = "top"
): Promise<FetchResult> =>
  runProviderEffect(
    fetchPostsEffect(handle, id, threadMode, contextMode, repliesMode)
  );
