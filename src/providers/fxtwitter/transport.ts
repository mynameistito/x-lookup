import { Schema } from "effect";

const optionalString = Schema.optional(Schema.String);
const optionalNumber = Schema.optional(Schema.Number);
const optionalBoolean = Schema.optional(Schema.Boolean);
const optionalStatusId = Schema.optional(
  Schema.Union([Schema.String, Schema.Number])
);

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

export const FxReplyingToTransportSchema = Schema.Union([
  Schema.Array(Schema.String),
  Schema.Struct({
    profile_url: optionalString,
    screen_name: optionalString,
    status: optionalString,
    url: optionalString,
  }),
  Schema.Null,
]);

export type FxReplyingToTransport = typeof FxReplyingToTransportSchema.Type;

const FxRepostedByTransportSchema = Schema.Union([
  FxAuthorTransportSchema,
  Schema.String,
  Schema.Null,
]);

export const FxTweetTransportSchema = Schema.Struct({
  article: Schema.optional(FxArticleTransportSchema),
  author: Schema.optional(FxAuthorTransportSchema),
  bookmarks: optionalNumber,
  community_note: Schema.optional(Schema.Unknown),
  created_at: optionalString,
  created_timestamp: optionalNumber,
  id: optionalStatusId,
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

export const FxEnvelopeTransportSchema = Schema.Struct({
  code: optionalNumber,
  conversation: Schema.optional(Schema.Array(Schema.Unknown)),
  cursor: Schema.optional(
    Schema.Struct({ bottom: optionalString, top: optionalString })
  ),
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

export type FxAuthorTransport = typeof FxAuthorTransportSchema.Type;
export type FxMediaItemTransport = typeof FxMediaItemTransportSchema.Type;
export type FxMediaTransport = typeof FxMediaTransportSchema.Type;
export type FxPollTransport = typeof FxPollTransportSchema.Type;
export type FxArticleTransport = typeof FxArticleTransportSchema.Type;
export type FxRepostedByTransport = typeof FxRepostedByTransportSchema.Type;
export type FxTweetTransport = typeof FxTweetTransportSchema.Type;
export type FxEnvelopeTransport = typeof FxEnvelopeTransportSchema.Type;

export const decodeEnvelope = Schema.decodeUnknownEffect(
  FxEnvelopeTransportSchema
);
export const decodeTweetTransport = Schema.decodeUnknownEffect(
  FxTweetTransportSchema
);
export const decodeAuthorTransport = Schema.decodeUnknownEffect(
  FxAuthorTransportSchema
);
