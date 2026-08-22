import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";

import { normalizeAuthor, normalizeTweet } from "@/lib/fxtwitter-normalize.ts";
import {
  decodeAuthorTransport,
  decodeEnvelope,
  decodeTweetTransport,
} from "@/lib/fxtwitter-transport.ts";
import { getParentStatusId } from "@/lib/fxtwitter-types.ts";
import type {
  FxAuthor,
  FxListResponse,
  FxReplyRanking,
  FxTweet,
} from "@/lib/fxtwitter-types.ts";
import {
  FxTwitterNetworkError,
  FxTwitterNonJsonError,
  FxTwitterNotFoundError,
  FxTwitterPrivateTweetError,
  FxTwitterSchemaError,
  FxTwitterSearchUnavailableError,
  FxTwitterUpstreamError,
} from "@/lib/provider-errors.ts";
import type { FxTwitterFailure } from "@/lib/provider-errors.ts";
import type { ProviderEffect } from "@/lib/provider-http.ts";

const FX_BASE = "https://api.fxtwitter.com";
const UA = "x-lookup/1.0";
const MAX_CHAIN_DEPTH = 100;

interface FxTweetPayload {
  readonly value: unknown;
}

interface FxAuthorPayload {
  readonly value: unknown;
}

const schemaFailure = (
  operation: string,
  cause: unknown
): FxTwitterSchemaError => new FxTwitterSchemaError({ cause, operation });

const decodeTweet = (
  payload: FxTweetPayload,
  operation: string
): Effect.Effect<FxTweet, FxTwitterSchemaError> =>
  Effect.gen(function* decodeTweetEffect() {
    const raw = yield* decodeTweetTransport(payload.value).pipe(
      Effect.mapError((cause) => schemaFailure(operation, cause))
    );
    const quote =
      raw.quote === undefined || raw.quote === null
        ? undefined
        : yield* decodeTweet({ value: raw.quote }, operation);
    return normalizeTweet({ ...raw, quote });
  });

const decodeAuthor = (
  payload: FxAuthorPayload,
  operation: string
): Effect.Effect<FxAuthor, FxTwitterSchemaError> =>
  decodeAuthorTransport(payload.value).pipe(
    Effect.map(normalizeAuthor),
    Effect.mapError((cause) => schemaFailure(operation, cause))
  );

const fxFetchJson = Effect.fn("FxTwitter.fetchJson")(
  function* fxFetchJsonEffect(path: string, operation: string) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .get(`${FX_BASE}/${path}`, {
        headers: { Accept: "application/json", "User-Agent": UA },
      })
      .pipe(
        Effect.mapError(
          (cause) => new FxTwitterNetworkError({ cause, operation })
        )
      );
    const json = yield* response.json.pipe(
      Effect.mapError(
        (cause) => new FxTwitterNonJsonError({ cause, operation })
      )
    );
    const data = yield* decodeEnvelope(json).pipe(
      Effect.mapError((cause) => schemaFailure(operation, cause))
    );

    if (data.code === 404 || data.message === "NOT_FOUND") {
      return yield* Effect.fail(
        new FxTwitterNotFoundError({ kind: "provider", operation })
      );
    }
    if (data.message === "PRIVATE_TWEET") {
      return yield* Effect.fail(new FxTwitterPrivateTweetError({ operation }));
    }
    if (
      response.status < 200 ||
      response.status >= 300 ||
      (data.code !== undefined && data.code >= 400)
    ) {
      return yield* Effect.fail(
        new FxTwitterUpstreamError({
          operation,
          upstreamMessage: data.message,
          upstreamStatus: response.status,
        })
      );
    }
    return data;
  }
);

const encodeQuery = (
  params: Record<string, string | number | undefined>
): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  return query.toString();
};

export const fetchFxProfileEffect = Effect.fn("FxTwitter.fetchProfile")(
  function* fetchFxProfileEffectGenerator(handle: string) {
    const operation = "profile";
    const data = yield* fxFetchJson(
      `2/profile/${encodeURIComponent(handle)}`,
      operation
    );
    if (data.user === undefined) {
      return yield* Effect.fail(
        new FxTwitterNotFoundError({ kind: "profile", operation })
      );
    }
    return yield* decodeAuthor({ value: data.user }, operation);
  }
);

export const fetchFxProfileStatusesEffect = Effect.fn(
  "FxTwitter.fetchProfileStatuses"
)(function* fetchFxProfileStatusesEffectGenerator(
  handle: string,
  cursor?: string,
  count = 20
) {
  const operation = "profile_statuses";
  const query = encodeQuery({ count, cursor, with_replies: "false" });
  const data = yield* fxFetchJson(
    `2/profile/${encodeURIComponent(handle)}/statuses?${query}`,
    operation
  );
  const results = yield* Effect.all(
    (data.results ?? []).map((item) => decodeTweet({ value: item }, operation))
  );
  return {
    cursor: data.cursor
      ? { bottom: data.cursor.bottom, top: data.cursor.top }
      : undefined,
    results,
  } satisfies FxListResponse<FxTweet>;
});

export const searchFxStatusesEffect = (
  queryText: string,
  feed: string,
  cursor?: string,
  count = 20
): ProviderEffect<FxListResponse<FxTweet>, FxTwitterFailure> => {
  const operation = "search";
  const query = encodeQuery({ count, cursor, feed, q: queryText });
  return Effect.gen(function* searchFxStatusesEffectGenerator() {
    const data = yield* fxFetchJson(`2/search?${query}`, operation);
    const results = yield* Effect.all(
      (data.results ?? []).map((item) =>
        decodeTweet({ value: item }, operation)
      )
    );
    return {
      cursor: data.cursor
        ? { bottom: data.cursor.bottom, top: data.cursor.top }
        : undefined,
      results,
    } satisfies FxListResponse<FxTweet>;
  }).pipe(
    Effect.catchTag("FxTwitterNotFoundError", () =>
      Effect.fail(new FxTwitterSearchUnavailableError({ operation: "search" }))
    )
  );
};

export const fetchFxConnectionsEffect = Effect.fn("FxTwitter.fetchConnections")(
  function* fetchFxConnectionsEffectGenerator(
    handle: string,
    relation: "followers" | "following",
    cursor?: string,
    count = 20
  ) {
    const operation = relation;
    const query = encodeQuery({ count, cursor });
    const data = yield* fxFetchJson(
      `2/profile/${encodeURIComponent(handle)}/${relation}?${query}`,
      operation
    );
    const results = yield* Effect.all(
      (data.results ?? []).map((item) =>
        decodeAuthor({ value: item }, operation)
      )
    );
    return {
      cursor: data.cursor
        ? { bottom: data.cursor.bottom, top: data.cursor.top }
        : undefined,
      results,
    } satisfies FxListResponse<FxAuthor>;
  }
);

export const fetchFxStatusEffect = Effect.fn("FxTwitter.fetchStatus")(
  function* fetchFxStatusEffectGenerator(id: string) {
    const operation = "status";
    const data = yield* fxFetchJson(
      `2/status/${encodeURIComponent(id)}`,
      operation
    );
    const raw = data.status ?? data.tweet;
    if (raw === undefined) {
      return yield* Effect.fail(
        new FxTwitterNotFoundError({ kind: "post", operation })
      );
    }
    return yield* decodeTweet({ value: raw }, operation);
  }
);

const walkParentChain = (
  currentId: string,
  walked: FxTweet[],
  seen: Set<string>
): ProviderEffect<FxTweet[], FxTwitterFailure> => {
  if (seen.has(currentId) || walked.length >= MAX_CHAIN_DEPTH) {
    return Effect.succeed(walked.toReversed());
  }
  seen.add(currentId);
  return fetchFxStatusEffect(currentId).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        error._tag === "FxTwitterPrivateTweetError"
          ? Effect.fail(error)
          : Effect.succeed(walked.toReversed()),
      onSuccess: (tweet) => {
        walked.push(tweet);
        const parentId = getParentStatusId(tweet);
        return parentId
          ? walkParentChain(parentId, walked, seen)
          : Effect.succeed(walked.toReversed());
      },
    })
  );
};

export const fetchFxConversationChainEffect = (
  id: string
): ProviderEffect<FxTweet[], FxTwitterFailure> =>
  walkParentChain(id, [], new Set());

export const fetchFxThreadEffect = Effect.fn("FxTwitter.fetchThread")(
  function* fetchFxThreadEffectGenerator(id: string) {
    const operation = "thread";
    const data = yield* fxFetchJson(
      `2/thread/${encodeURIComponent(id)}`,
      operation
    );
    if (data.thread?.length) {
      return yield* Effect.all(
        data.thread.map((item) => decodeTweet({ value: item }, operation))
      );
    }
    return [yield* fetchFxStatusEffect(id)];
  }
);

const tweetTimestamp = (tweet: FxTweet): number => {
  const timestamp = tweet.created_timestamp;
  return timestamp === undefined
    ? Date.parse(tweet.created_at ?? "") || 0
    : timestamp;
};

export const fetchFxConversationRepliesEffect = Effect.fn(
  "FxTwitter.fetchConversationReplies"
)(function* fetchFxConversationRepliesEffectGenerator(
  id: string,
  rankingMode: FxReplyRanking = "likes",
  limit = 10
) {
  const operation = "conversation";
  const query = encodeQuery({ ranking_mode: rankingMode });
  const data = yield* fxFetchJson(
    `2/conversation/${encodeURIComponent(id)}?${query}`,
    operation
  );
  const primary = data.replies ?? data.results;
  const replies = primary ?? data.tweets ?? data.conversation;
  const decoded = yield* Effect.all(
    (replies ?? []).map((item) => decodeTweet({ value: item }, operation))
  );
  return decoded
    .filter((tweet) => getParentStatusId(tweet) === id)
    .toSorted((a, b) => {
      const byRanking =
        rankingMode === "likes"
          ? (b.likes ?? 0) - (a.likes ?? 0)
          : tweetTimestamp(b) - tweetTimestamp(a);
      return (
        byRanking ||
        tweetTimestamp(b) - tweetTimestamp(a) ||
        String(a.id ?? "").localeCompare(String(b.id ?? ""))
      );
    })
    .slice(0, limit);
});

export const fetchFxFullThreadEffect = Effect.fn("FxTwitter.fetchFullThread")(
  function* fetchFxFullThreadEffectGenerator(id: string) {
    const fromThread = yield* fetchFxThreadEffect(id);
    if (fromThread.length > 1) {
      return fromThread;
    }
    const tweet = fromThread[0] ?? (yield* fetchFxStatusEffect(id));
    if (!getParentStatusId(tweet)) {
      return [tweet];
    }
    const chain = yield* fetchFxConversationChainEffect(id);
    return chain.length > 0 ? chain : [tweet];
  }
);
