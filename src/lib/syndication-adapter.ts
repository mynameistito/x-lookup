import { Effect, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";

import type {
  FxArticle,
  FxArticleBlock,
  FxMedia,
  FxMediaItem,
  FxTweet,
} from "./fxtwitter-types.js";
import {
  SyndicationEmptyError,
  SyndicationNetworkError,
  SyndicationNonJsonError,
  SyndicationSchemaError,
  SyndicationUpstreamError,
} from "./provider-errors.js";
import type { SyndicationFailure } from "./provider-errors.js";
import type { ProviderEffect } from "./provider-http.js";

const SYNDICATION_BASE = "https://cdn.syndication.twimg.com/tweet-result";
const UA = "Mozilla/5.0 (compatible; x-lookup/1.0)";

const optionalString = Schema.optional(Schema.String);
const optionalNumber = Schema.optional(Schema.Number);
const optionalBoolean = Schema.optional(Schema.Boolean);

const SyndicationUrlTransportSchema = Schema.Struct({
  display_url: optionalString,
  expanded_url: optionalString,
});

const SyndicationUserTransportSchema = Schema.Struct({
  created_at: optionalString,
  description: optionalString,
  entities: Schema.optional(
    Schema.Struct({
      url: Schema.optional(
        Schema.Struct({
          urls: Schema.optional(Schema.Array(SyndicationUrlTransportSchema)),
        })
      ),
    })
  ),
  followers_count: optionalNumber,
  friends_count: optionalNumber,
  location: optionalString,
  name: optionalString,
  profile_image_url_https: optionalString,
  screen_name: optionalString,
  statuses_count: optionalNumber,
  url: optionalString,
  verified: optionalBoolean,
});

const SyndicationVariantTransportSchema = Schema.Struct({
  bitrate: optionalNumber,
  content_type: optionalString,
  url: optionalString,
});

const SyndicationMediaTransportSchema = Schema.Struct({
  media_url_https: optionalString,
  original_info: Schema.optional(
    Schema.Struct({ height: optionalNumber, width: optionalNumber })
  ),
  sizes: Schema.optional(
    Schema.Struct({
      large: Schema.optional(
        Schema.Struct({ h: optionalNumber, w: optionalNumber })
      ),
    })
  ),
  type: optionalString,
  url: optionalString,
  video_info: Schema.optional(
    Schema.Struct({
      aspect_ratio: Schema.optional(Schema.Tuple([Schema.Number, Schema.Number])),
      duration_millis: optionalNumber,
      variants: Schema.optional(Schema.Array(SyndicationVariantTransportSchema)),
    })
  ),
});

const SyndicationArticleTransportSchema = Schema.Struct({
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

const SyndicationTweetTransportSchema = Schema.Struct({
  article: Schema.optional(SyndicationArticleTransportSchema),
  conversation_count: optionalNumber,
  created_at: optionalString,
  entities: Schema.optional(
    Schema.Struct({
      media: Schema.optional(Schema.Array(SyndicationMediaTransportSchema)),
    })
  ),
  favorite_count: optionalNumber,
  id_str: optionalString,
  lang: optionalString,
  mediaDetails: Schema.optional(Schema.Array(SyndicationMediaTransportSchema)),
  photos: Schema.optional(Schema.Array(SyndicationMediaTransportSchema)),
  quoted_status_result: Schema.optional(
    Schema.Struct({
      result: Schema.optional(
        Schema.Struct({
          legacy: Schema.optional(Schema.Unknown),
          tweet: Schema.optional(Schema.Unknown),
        })
      ),
    })
  ),
  quoted_tweet: Schema.optional(Schema.Unknown),
  text: optionalString,
  user: Schema.optional(SyndicationUserTransportSchema),
  video: Schema.optional(SyndicationMediaTransportSchema),
});

type SyndicationUserTransport = typeof SyndicationUserTransportSchema.Type;
type SyndicationMediaTransport = typeof SyndicationMediaTransportSchema.Type;
type SyndicationArticleTransport = typeof SyndicationArticleTransportSchema.Type;
type SyndicationTweetTransport = typeof SyndicationTweetTransportSchema.Type;

type Mp4Variant = {
  readonly bitrate?: number;
  readonly content_type?: string;
  readonly url: string;
};

const decodeTransport = Schema.decodeUnknownEffect(SyndicationTweetTransportSchema);

const bestMp4Variants = (media: SyndicationMediaTransport): Mp4Variant[] =>
  media.video_info?.variants
    ?.filter((variant): variant is Mp4Variant =>
      Boolean(variant.url && variant.content_type?.includes("video/mp4"))
    )
    .toSorted((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)) ?? [];

const buildVideoItem = (
  media: SyndicationMediaTransport,
  type: "animated_gif" | "video"
): FxMediaItem => {
  const variants = bestMp4Variants(media);
  const [best] = variants;
  const poster = media.media_url_https ?? media.url;
  return {
    bitrate: best?.bitrate,
    duration_ms: media.video_info?.duration_millis,
    height: media.original_info?.height ?? media.sizes?.large?.h,
    thumbnail_url: poster,
    type,
    url: best?.url ?? poster,
    variants,
    width: media.original_info?.width ?? media.sizes?.large?.w,
  };
};

const buildPhotoItem = (
  media: SyndicationMediaTransport
): FxMediaItem | undefined => {
  const url = media.media_url_https ?? media.url;
  return url ? { thumbnail_url: url, type: "photo", url } : undefined;
};

const buildMediaItem = (
  media: SyndicationMediaTransport
): FxMediaItem | undefined => {
  const type = (media.type ?? "photo").toLowerCase();
  if (type === "photo") {
    return buildPhotoItem(media);
  }
  if (type === "video") {
    return buildVideoItem(media, "video");
  }
  if (type === "animated_gif") {
    return buildVideoItem(media, "animated_gif");
  }
  return undefined;
};

const dedupeMedia = (
  candidates: readonly SyndicationMediaTransport[]
): SyndicationMediaTransport[] => {
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key =
      item.media_url_https ?? item.url ?? item.video_info?.variants?.[0]?.url;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const mapMedia = (raw: SyndicationTweetTransport): FxMedia | undefined => {
  const fallbackItems = [
    ...(raw.photos ?? []),
    ...(raw.video ? [raw.video] : []),
    ...(raw.entities?.media ?? []),
  ];
  const candidates = raw.mediaDetails?.length
    ? raw.mediaDetails
    : fallbackItems;
  const items = dedupeMedia(candidates)
    .map(buildMediaItem)
    .filter((item): item is FxMediaItem => item !== undefined);

  const media: FxMedia = {};
  const photos = items.filter((item) => item.type === "photo");
  const videos = items.filter((item) => item.type === "video");
  const animated = items.filter((item) => item.type === "animated_gif");
  if (photos.length) {
    media.photos = photos;
  }
  if (videos.length) {
    media.videos = videos;
  }
  if (animated.length) {
    media.animated = animated;
  }
  return Object.keys(media).length ? media : undefined;
};

const mapArticle = (
  raw?: SyndicationArticleTransport
): FxArticle | undefined => {
  if (!raw?.title && !raw?.preview_text) {
    return undefined;
  }
  const blocks: FxArticleBlock[] = [];
  if (raw.preview_text) {
    blocks.push({ text: raw.preview_text, type: "unstyled" });
  }
  return {
    content: blocks.length ? { blocks } : undefined,
    cover_media: raw.cover_media,
    preview_text: raw.preview_text,
    title: raw.title,
  };
};

const mapUser = (user?: SyndicationUserTransport): FxTweet["author"] => {
  if (!user) {
    return undefined;
  }
  const website = user.entities?.url?.urls?.[0];
  return {
    avatar_url: user.profile_image_url_https,
    description: user.description,
    followers: user.followers_count,
    following: user.friends_count,
    joined: user.created_at,
    location: user.location,
    name: user.name,
    screen_name: user.screen_name,
    statuses: user.statuses_count,
    url: user.screen_name ? `https://x.com/${user.screen_name}` : user.url,
    verification: { verified: user.verified },
    website: website
      ? { display_url: website.display_url, url: website.expanded_url }
      : undefined,
  };
};

const decodeSyndicationTweet = (
  payload: unknown,
  handle?: string,
  id?: string
): Effect.Effect<FxTweet, SyndicationSchemaError> =>
  Effect.gen(function* decodeSyndicationTweetEffect() {
    const raw = yield* decodeTransport(payload).pipe(
      Effect.mapError(
        (cause) => new SyndicationSchemaError({ cause, operation: "status" })
      )
    );
    const quoted =
      raw.quoted_tweet ??
      raw.quoted_status_result?.result?.legacy ??
      raw.quoted_status_result?.result?.tweet;
    const quote =
      quoted === undefined
        ? undefined
        : yield* decodeSyndicationTweet(quoted);
    const screenName = raw.user?.screen_name ?? handle;
    const ownId = raw.id_str ?? id;

    return {
      article: mapArticle(raw.article),
      author: mapUser(raw.user),
      created_at: raw.created_at,
      id: ownId,
      lang: raw.lang,
      likes: raw.favorite_count,
      media: mapMedia(raw),
      quote,
      replies: raw.conversation_count,
      text: raw.text,
      url:
        screenName && ownId
          ? `https://x.com/${screenName}/status/${ownId}`
          : undefined,
    };
  });

export const fetchSyndicationStatusEffect = Effect.fn(
  "Syndication.fetchStatus"
)(function* fetchSyndicationStatusEffectGenerator(
  handle: string,
  id: string
): ProviderEffect<FxTweet, SyndicationFailure> {
  const client = yield* HttpClient.HttpClient;
  const url = `${SYNDICATION_BASE}?id=${encodeURIComponent(id)}&lang=en&token=0`;
  const response = yield* client
    .get(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
    })
    .pipe(
      Effect.mapError(
        (cause) => new SyndicationNetworkError({ cause, operation: "status" })
      )
    );

  if (response.status < 200 || response.status >= 300) {
    return yield* Effect.fail(
      new SyndicationUpstreamError({
        operation: "status",
        status: response.status === 404 ? 404 : 502,
        upstreamStatus: response.status,
      })
    );
  }

  const json = yield* response.json.pipe(
    Effect.mapError(
      (cause) => new SyndicationNonJsonError({ cause, operation: "status" })
    )
  );
  const tweet = yield* decodeSyndicationTweet(json, handle, id);
  if (!tweet.text && !tweet.article) {
    return yield* Effect.fail(new SyndicationEmptyError({ operation: "status" }));
  }
  return tweet;
});
