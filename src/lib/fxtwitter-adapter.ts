import { Effect, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";

import { getParentStatusId } from "./fxtwitter-types.js";
import type {
  FxArticle,
  FxAuthor,
  FxListResponse,
  FxMedia,
  FxMediaItem,
  FxPoll,
  FxReplyRanking,
  FxReplyingTo,
  FxTweet,
} from "./fxtwitter-types.js";
import {
  FxTwitterNetworkError,
  FxTwitterNonJsonError,
  FxTwitterNotFoundError,
  FxTwitterPrivateTweetError,
  FxTwitterSchemaError,
  FxTwitterSearchUnavailableError,
  FxTwitterUpstreamError,
} from "./provider-errors.js";
import type { FxTwitterFailure } from "./provider-errors.js";
import type { ProviderEffect } from "./provider-http.js";

const FX_BASE = "https://api.fxtwitter.com";
const UA = "x-lookup/1.0";
const MAX_CHAIN_DEPTH = 100;

const optionalString = Schema.optional(Schema.String);
const optionalNumber = Schema.optional(Schema.Number);
const optionalBoolean = Schema.optional(Schema.Boolean);

const FxWebsiteTransportSchema = Schema.Struct({
  display_url: optionalString,
  url: optionalString,
});

const FxVerificationTransportSchema = Schema.Struct({
  type: optionalString,
  verified: optionalBoolean,
});

const FxAuthorTransportSchema = Schema.Struct({
  avatar_url: optionalString,
  banner_url: optionalString,
  description: optionalString,
  followers: optionalNumber,
  following: optionalNumber,
  id: optionalString,
  joined: optionalString,
  likes: optionalNumber,
  location: optionalString,
  media_count: optionalNumber,
  name: optionalString,
  protected: optionalBoolean,
  screen_name: optionalString,
  statuses: optionalNumber,
  url: optionalString,
  verification: Schema.optional(FxVerificationTransportSchema),
  website: Schema.optional(FxWebsiteTransportSchema),
});

const FxMediaVariantTransportSchema = Schema.Struct({
  bitrate: optionalNumber,
  content_type: optionalString,
  url: optionalString,
});

const FxMediaFormatTransportSchema = Schema.Struct({
  bitrate: optionalNumber,
  codec: optionalString,
  container: optionalString,
  url: optionalString,
});

const FxMediaItemTransportSchema = Schema.Struct({
  alt: optionalString,
  altText: optionalString,
  bitrate: optionalNumber,
  duration: optionalNumber,
  duration_ms: optionalNumber,
  format: optionalString,
  formats: Schema.optional(Schema.Array(FxMediaFormatTransportSchema)),
  height: optionalNumber,
  thumbnail_url: optionalString,
  type: optionalString,
  url: optionalString,
  variants: Schema.optional(Schema.Array(FxMediaVariantTransportSchema)),
  width: optionalNumber,
});

const FxMosaicTransportSchema = Schema.Struct({
  formats: Schema.optional(
    Schema.Struct({ jpeg: optionalString, webp: optionalString })
  ),
  photos: Schema.optional(Schema.Array(FxMediaItemTransportSchema)),
  type: optionalString,
});

const FxMediaTransportSchema = Schema.Struct({
  all: Schema.optional(Schema.Array(FxMediaItemTransportSchema)),
  animated: Schema.optional(Schema.Array(FxMediaItemTransportSchema)),
  mosaic: Schema.optional(FxMosaicTransportSchema),
  photos: Schema.optional(Schema.Array(FxMediaItemTransportSchema)),
  videos: Schema.optional(Schema.Array(FxMediaItemTransportSchema)),
});

const FxPollChoiceTransportSchema = Schema.Struct({
  count: optionalNumber,
  label: optionalString,
  percentage: optionalNumber,
});

const FxPollTransportSchema = Schema.Struct({
  choices: Schema.optional(Schema.Array(FxPollChoiceTransportSchema)),
  ends_at: optionalString,
  time_left_en: optionalString,
  total_votes: optionalNumber,
});

const FxArticleBlockTransportSchema = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      urls: Schema.optional(
        Schema.Array(
          Schema.Struct({
            fromIndex: Schema.Number,
            text: Schema.String,
            toIndex: Schema.Number,
          })
        )
      ),
    })
  ),
  inlineStyleRanges: Schema.optional(
    Schema.Array(
      Schema.Struct({
        length: Schema.Number,
        offset: Schema.Number,
        style: Schema.String,
      })
    )
  ),
  text: optionalString,
  type: optionalString,
});

const FxArticleTransportSchema = Schema.Struct({
  content: Schema.optional(
    Schema.Struct({
      blocks: Schema.optional(Schema.Array(FxArticleBlockTransportSchema)),
    })
  ),
  cover_media: Schema.optional(
    Schema.Struct({
      media_info: Schema.optional(
        Schema.Struct({ original_img_url: optionalString })
      ),
    })
  ),
  preview_text: optionalString,
  title: optionalString,
});

const FxReplyingToTransportSchema = Schema.Union([
  Schema.Array(Schema.String),
  Schema.Struct({
    profile_url: optionalString,
    screen_name: optionalString,
    status: optionalString,
    url: optionalString,
  }),
  Schema.Null,
]);

const FxRepostedByTransportSchema = Schema.Union([
  FxAuthorTransportSchema,
  Schema.String,
  Schema.Null,
]);

const FxTweetTransportSchema = Schema.Struct({
  article: Schema.optional(FxArticleTransportSchema),
  author: Schema.optional(FxAuthorTransportSchema),
  bookmarks: optionalNumber,
  community_note: Schema.optional(Schema.Unknown),
  created_at: optionalString,
  created_timestamp: optionalNumber,
  id: optionalString,
  lang: optionalString,
  likes: optionalNumber,
  media: Schema.optional(FxMediaTransportSchema),
  poll: Schema.optional(FxPollTransportSchema),
  possibly_sensitive: optionalBoolean,
  quote: Schema.optional(Schema.Unknown),
  quotes: optionalNumber,
  replies: optionalNumber,
  replying_to: Schema.optional(FxReplyingToTransportSchema),
  replying_to_status: Schema.optional(
    Schema.Union([Schema.Array(Schema.String), Schema.Null])
  ),
  reposted_by: Schema.optional(FxRepostedByTransportSchema),
  reposts: optionalNumber,
  retweets: optionalNumber,
  source: optionalString,
  text: optionalString,
  url: optionalString,
  views: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
});

const FxCursorTransportSchema = Schema.Struct({
  bottom: optionalString,
  top: optionalString,
});

const FxEnvelopeTransportSchema = Schema.Struct({
  code: optionalNumber,
  conversation: Schema.optional(Schema.Array(Schema.Unknown)),
  cursor: Schema.optional(FxCursorTransportSchema),
  message: optionalString,
  replies: Schema.optional(
    Schema.Union([Schema.Array(Schema.Unknown), Schema.Null])
  ),
  results: Schema.optional(Schema.Array(Schema.Unknown)),
  status: Schema.optional(Schema.Unknown),
  thread: Schema.optional(Schema.Array(Schema.Unknown)),
  tweet: Schema.optional(Schema.Unknown),
  tweets: Schema.optional(Schema.Array(Schema.Unknown)),
  user: Schema.optional(Schema.Unknown),
});

type FxAuthorTransport = typeof FxAuthorTransportSchema.Type;
type FxMediaItemTransport = typeof FxMediaItemTransportSchema.Type;
type FxMediaTransport = typeof FxMediaTransportSchema.Type;
type FxPollTransport = typeof FxPollTransportSchema.Type;
type FxArticleTransport = typeof FxArticleTransportSchema.Type;
type FxRepostedByTransport = typeof FxRepostedByTransportSchema.Type;

interface FxTweetPayload {
  readonly value: unknown;
}

interface FxAuthorPayload {
  readonly value: unknown;
}

const decodeEnvelope = Schema.decodeUnknownEffect(FxEnvelopeTransportSchema);
const decodeTweetTransport = Schema.decodeUnknownEffect(FxTweetTransportSchema);
const decodeAuthorTransport = Schema.decodeUnknownEffect(
  FxAuthorTransportSchema
);

const CONTAINER_CONTENT_TYPES = new Map([
  ["m3u8", "application/vnd.apple.mpegurl"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
]);

const containerContentType = (container?: string): string | undefined => {
  if (!container) {
    return undefined;
  }
  return container.includes("/")
    ? container
    : CONTAINER_CONTENT_TYPES.get(container);
};

const normalizeMediaItem = (item: FxMediaItemTransport): FxMediaItem => {
  const formats = item.formats?.flatMap((format) =>
    format.url
      ? [
          {
            bitrate: format.bitrate,
            codec: format.codec,
            container: format.container,
            url: format.url,
          },
        ]
      : []
  );
  const variants = item.variants?.flatMap((variant) =>
    variant.url
      ? [
          {
            bitrate: variant.bitrate,
            content_type: variant.content_type,
            url: variant.url,
          },
        ]
      : []
  );
  const formatVariants = formats?.map((format) => ({
    bitrate: format.bitrate,
    content_type: containerContentType(format.container),
    url: format.url,
  }));
  return {
    alt: item.alt ?? item.altText,
    altText: item.altText,
    bitrate: item.bitrate,
    duration: item.duration,
    duration_ms:
      item.duration_ms ??
      (item.duration === undefined ? undefined : item.duration * 1000),
    format: item.format,
    formats,
    height: item.height,
    thumbnail_url: item.thumbnail_url,
    type: item.type,
    url: item.url,
    variants: variants ?? formatVariants,
    width: item.width,
  };
};

const normalizeMedia = (media?: FxMediaTransport): FxMedia | undefined => {
  if (!media || Object.keys(media).length === 0) {
    return undefined;
  }
  const mapItems = (items?: readonly FxMediaItemTransport[]) =>
    items?.map(normalizeMediaItem);
  return {
    all: mapItems(media.all),
    animated: mapItems(media.animated),
    mosaic: media.mosaic
      ? {
          formats: media.mosaic.formats
            ? {
                jpeg: media.mosaic.formats.jpeg,
                webp: media.mosaic.formats.webp,
              }
            : undefined,
          photos: mapItems(media.mosaic.photos),
          type: media.mosaic.type,
        }
      : undefined,
    photos: mapItems(media.photos),
    videos: mapItems(media.videos),
  };
};

const normalizeAuthor = (author: FxAuthorTransport): FxAuthor => ({
  avatar_url: author.avatar_url,
  banner_url: author.banner_url,
  description: author.description,
  followers: author.followers,
  following: author.following,
  id: author.id,
  joined: author.joined,
  likes: author.likes,
  location: author.location,
  media_count: author.media_count,
  name: author.name,
  protected: author.protected,
  screen_name: author.screen_name,
  statuses: author.statuses,
  url: author.url,
  verification: author.verification
    ? {
        type: author.verification.type,
        verified: author.verification.verified,
      }
    : undefined,
  website: author.website
    ? { display_url: author.website.display_url, url: author.website.url }
    : undefined,
});

const normalizePoll = (poll?: FxPollTransport): FxPoll | undefined =>
  poll
    ? {
        choices: poll.choices?.map((choice) => ({
          count: choice.count,
          label: choice.label,
          percentage: choice.percentage,
        })),
        ends_at: poll.ends_at,
        time_left_en: poll.time_left_en,
        total_votes: poll.total_votes,
      }
    : undefined;

const normalizeArticle = (
  article?: FxArticleTransport
): FxArticle | undefined =>
  article
    ? {
        content: article.content
          ? {
              blocks: article.content.blocks?.map((block) => ({
                data: block.data
                  ? {
                      urls: block.data.urls?.map((url) => ({
                        fromIndex: url.fromIndex,
                        text: url.text,
                        toIndex: url.toIndex,
                      })),
                    }
                  : undefined,
                inlineStyleRanges: block.inlineStyleRanges?.map((range) => ({
                  length: range.length,
                  offset: range.offset,
                  style: range.style,
                })),
                text: block.text,
                type: block.type,
              })),
            }
          : undefined,
        cover_media: article.cover_media
          ? {
              media_info: article.cover_media.media_info
                ? {
                    original_img_url:
                      article.cover_media.media_info.original_img_url,
                  }
                : undefined,
            }
          : undefined,
        preview_text: article.preview_text,
        title: article.title,
      }
    : undefined;

const isStringArray = (
  value: typeof FxReplyingToTransportSchema.Type
): value is readonly string[] => Array.isArray(value);

const normalizeReplyingTo = (
  replyingTo: typeof FxReplyingToTransportSchema.Type | undefined
): FxReplyingTo | undefined => {
  if (replyingTo === undefined || replyingTo === null) {
    return replyingTo;
  }
  if (isStringArray(replyingTo)) {
    return [...replyingTo];
  }
  return {
    profile_url: replyingTo.profile_url,
    screen_name: replyingTo.screen_name,
    status: replyingTo.status,
    url: replyingTo.url,
  };
};

const normalizeReplyingToStatus = (
  status: readonly string[] | null | undefined
): string[] | null | undefined => {
  if (status === null) {
    return null;
  }
  return status ? [...status] : undefined;
};

const normalizeRepostedBy = (
  author: FxRepostedByTransport | undefined
): FxAuthor | null | undefined => {
  if (author === null) {
    return null;
  }
  if (author === undefined) {
    return undefined;
  }
  if (Schema.is(Schema.String)(author)) {
    return { screen_name: author };
  }
  return normalizeAuthor(author);
};

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
    return {
      article: normalizeArticle(raw.article),
      author: raw.author ? normalizeAuthor(raw.author) : undefined,
      bookmarks: raw.bookmarks,
      community_note: raw.community_note,
      created_at: raw.created_at,
      created_timestamp: raw.created_timestamp,
      id: raw.id,
      lang: raw.lang,
      likes: raw.likes,
      media: normalizeMedia(raw.media),
      poll: normalizePoll(raw.poll),
      possibly_sensitive: raw.possibly_sensitive,
      quote,
      quotes: raw.quotes,
      replies: raw.replies,
      replying_to: normalizeReplyingTo(raw.replying_to),
      replying_to_status: normalizeReplyingToStatus(raw.replying_to_status),
      reposted_by: normalizeRepostedBy(raw.reposted_by),
      reposts: raw.reposts,
      retweets: raw.retweets ?? raw.reposts,
      source: raw.source,
      text: raw.text,
      url: raw.url,
      views: raw.views,
    };
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
