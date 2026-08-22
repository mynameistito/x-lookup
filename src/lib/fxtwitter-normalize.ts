import { Schema } from "effect";

import type {
  FxArticleTransport,
  FxAuthorTransport,
  FxMediaItemTransport,
  FxMediaTransport,
  FxPollTransport,
  FxReplyingToTransport,
  FxRepostedByTransport,
} from "@/lib/fxtwitter-transport.ts";
import type {
  FxArticle,
  FxAuthor,
  FxMedia,
  FxMediaItem,
  FxPoll,
  FxReplyingTo,
  FxTweet,
} from "@/lib/fxtwitter-types.ts";

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

/** Normalize one provider media item into the application media shape. */
export const normalizeMediaItem = (item: FxMediaItemTransport): FxMediaItem => {
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

/** Normalize all provider media collections, omitting an empty media object. */
export const normalizeMedia = (
  media?: FxMediaTransport
): FxMedia | undefined => {
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

/** Normalize a provider author. */
export const normalizeAuthor = (author: FxAuthorTransport): FxAuthor => ({
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
    ? { type: author.verification.type, verified: author.verification.verified }
    : undefined,
  website: author.website
    ? { display_url: author.website.display_url, url: author.website.url }
    : undefined,
});

/** Normalize a provider poll. */
export const normalizePoll = (poll?: FxPollTransport): FxPoll | undefined =>
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

/** Normalize provider article content without applying presentation policy. */
export const normalizeArticle = (
  article?: FxArticleTransport
): FxArticle | undefined =>
  article
    ? {
        content: article.content
          ? {
              blocks: article.content.blocks?.map((block) => ({
                data: block.data
                  ? { urls: block.data.urls?.map((url) => ({ ...url })) }
                  : undefined,
                inlineStyleRanges: block.inlineStyleRanges?.map((range) => ({
                  ...range,
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

/** Normalize the provider's historical reply-target representations. */
export const normalizeReplyingTo = (
  replyingTo: FxReplyingToTransport | undefined
): FxReplyingTo | undefined => {
  if (replyingTo === undefined || replyingTo === null) {
    return replyingTo;
  }
  if (Array.isArray(replyingTo)) {
    const strings: string[] = [];
    for (const value of replyingTo) {
      strings.push(value);
    }
    return strings;
  }
  return {
    profile_url: replyingTo.profile_url,
    screen_name: replyingTo.screen_name,
    status: replyingTo.status,
    url: replyingTo.url,
  };
};

/** Normalize the provider's optional parent-status array. */
export const normalizeReplyingToStatus = (
  status: readonly string[] | null | undefined
): string[] | null | undefined => {
  if (status === null) {
    return null;
  }
  if (status) {
    return [...status];
  }
  return undefined;
};

/** Normalize legacy string and object repost-author payloads. */
export const normalizeRepostedBy = (
  author?: FxRepostedByTransport
): FxAuthor | null | undefined => {
  if (author === null || author === undefined) {
    return author;
  }
  if (Schema.is(Schema.String)(author)) {
    return { screen_name: author };
  }
  return normalizeAuthor(author);
};

/** Normalize the scalar and nested fields of a decoded provider tweet. */
export const normalizeTweet = (raw: {
  readonly article?: FxArticleTransport;
  readonly author?: FxAuthorTransport;
  readonly bookmarks?: number;
  readonly community_note?: unknown;
  readonly created_at?: string;
  readonly created_timestamp?: number;
  readonly id?: string;
  readonly lang?: string;
  readonly likes?: number;
  readonly media?: FxMediaTransport;
  readonly poll?: FxPollTransport;
  readonly possibly_sensitive?: boolean;
  readonly quote?: FxTweet;
  readonly quotes?: number;
  readonly replies?: number;
  readonly replying_to?: FxReplyingToTransport;
  readonly replying_to_status?: readonly string[] | null;
  readonly reposted_by?: FxRepostedByTransport;
  readonly reposts?: number;
  readonly retweets?: number;
  readonly source?: string;
  readonly text?: string;
  readonly url?: string;
  readonly views?: number | null;
}): FxTweet => ({
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
  quote: raw.quote,
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
});
