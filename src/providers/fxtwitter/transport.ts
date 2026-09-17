import { Schema, SchemaGetter } from "effect";

/**
 * A struct field the provider may omit. FxTwitter encodes absent values by
 * omission *and* as `null` (for example an author with no `website`, or an
 * unverified author whose `verification.type` is `null`), so decode both to
 * `undefined` and keep the decoded shape unchanged.
 */
const optionalNullish = <S extends Schema.Constraint>(schema: S) =>
  Schema.optional(
    Schema.NullOr(schema).pipe(
      Schema.decodeTo(Schema.UndefinedOr(schema), {
        decode: SchemaGetter.transform(
          (value: S["Type"] | null): S["Type"] | undefined => value ?? undefined
        ),
        encode: SchemaGetter.transform(
          (value: S["Type"] | undefined): S["Type"] | null => value ?? null
        ),
      })
    )
  );

const optionalString = optionalNullish(Schema.String);
const optionalNumber = optionalNullish(Schema.Number);
const optionalBoolean = optionalNullish(Schema.Boolean);
const optionalStatusId = optionalNullish(
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
  verification: optionalNullish(FxVerificationTransportSchema),
  website: optionalNullish(FxWebsiteTransportSchema),
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
  formats: optionalNullish(Schema.Array(FxMediaFormatTransportSchema)),
  height: optionalNumber,
  thumbnail_url: optionalString,
  type: optionalString,
  url: optionalString,
  variants: optionalNullish(Schema.Array(FxMediaVariantTransportSchema)),
  width: optionalNumber,
});

const FxMosaicTransportSchema = Schema.Struct({
  formats: optionalNullish(
    Schema.Struct({ jpeg: optionalString, webp: optionalString })
  ),
  photos: optionalNullish(Schema.Array(FxMediaItemTransportSchema)),
  type: optionalString,
});

const FxMediaTransportSchema = Schema.Struct({
  all: optionalNullish(Schema.Array(FxMediaItemTransportSchema)),
  animated: optionalNullish(Schema.Array(FxMediaItemTransportSchema)),
  mosaic: optionalNullish(FxMosaicTransportSchema),
  photos: optionalNullish(Schema.Array(FxMediaItemTransportSchema)),
  videos: optionalNullish(Schema.Array(FxMediaItemTransportSchema)),
});

const FxPollChoiceTransportSchema = Schema.Struct({
  count: optionalNumber,
  label: optionalString,
  percentage: optionalNumber,
});

const FxPollTransportSchema = Schema.Struct({
  choices: optionalNullish(Schema.Array(FxPollChoiceTransportSchema)),
  ends_at: optionalString,
  time_left_en: optionalString,
  total_votes: optionalNumber,
});

const FxArticleBlockTransportSchema = Schema.Struct({
  data: optionalNullish(
    Schema.Struct({
      urls: optionalNullish(
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
  inlineStyleRanges: optionalNullish(
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
  content: optionalNullish(
    Schema.Struct({
      blocks: optionalNullish(Schema.Array(FxArticleBlockTransportSchema)),
    })
  ),
  cover_media: optionalNullish(
    Schema.Struct({
      media_info: optionalNullish(
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
  article: optionalNullish(FxArticleTransportSchema),
  author: optionalNullish(FxAuthorTransportSchema),
  bookmarks: optionalNumber,
  community_note: Schema.optional(Schema.Unknown),
  created_at: optionalString,
  created_timestamp: optionalNumber,
  id: optionalStatusId,
  lang: optionalString,
  likes: optionalNumber,
  media: optionalNullish(FxMediaTransportSchema),
  poll: optionalNullish(FxPollTransportSchema),
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
  conversation: optionalNullish(Schema.Array(Schema.Unknown)),
  cursor: optionalNullish(
    Schema.Struct({ bottom: optionalString, top: optionalString })
  ),
  message: optionalString,
  replies: Schema.optional(
    Schema.Union([Schema.Array(Schema.Unknown), Schema.Null])
  ),
  results: optionalNullish(Schema.Array(Schema.Unknown)),
  status: Schema.optional(Schema.Unknown),
  thread: optionalNullish(Schema.Array(Schema.Unknown)),
  tweet: Schema.optional(Schema.Unknown),
  tweets: optionalNullish(Schema.Array(Schema.Unknown)),
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
