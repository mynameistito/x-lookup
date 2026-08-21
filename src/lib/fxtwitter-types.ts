export interface FxAuthor {
  id?: string;
  name?: string;
  screen_name?: string;
  url?: string;
  description?: string;
  location?: string;
  followers?: number;
  following?: number;
  likes?: number;
  media_count?: number;
  statuses?: number;
  joined?: string;
  avatar_url?: string;
  banner_url?: string;
  protected?: boolean;
  website?: { url?: string; display_url?: string };
  verification?: { verified?: boolean; type?: string };
}

export interface FxMediaItem {
  type?: string;
  url?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration?: number;
  duration_ms?: number;
  format?: string;
  bitrate?: number;
  alt?: string;
  altText?: string;
  variants?: {
    url: string;
    content_type?: string;
    bitrate?: number;
  }[];
  formats?: {
    url: string;
    container?: string;
    codec?: string;
    bitrate?: number;
  }[];
}

export interface FxMosaic {
  type?: string;
  photos?: FxMediaItem[];
  formats?: { jpeg?: string; webp?: string };
}

export interface FxMedia {
  photos?: FxMediaItem[];
  videos?: FxMediaItem[];
  animated?: FxMediaItem[];
  mosaic?: FxMosaic;
  all?: FxMediaItem[];
}

export interface FxPollChoice {
  label?: string;
  count?: number;
  percentage?: number;
}

export interface FxPoll {
  choices?: FxPollChoice[];
  total_votes?: number;
  time_left_en?: string;
  ends_at?: string;
}

export interface FxArticleBlock {
  type?: string;
  text?: string;
  inlineStyleRanges?: { offset: number; length: number; style: string }[];
  data?: { urls?: { fromIndex: number; toIndex: number; text: string }[] };
}

export interface FxArticle {
  title?: string;
  preview_text?: string;
  content?: { blocks?: FxArticleBlock[] };
  cover_media?: { media_info?: { original_img_url?: string } };
}

export type FxReplyingTo =
  | string[]
  | {
      screen_name?: string;
      status?: string;
      url?: string;
      profile_url?: string;
    }
  | null;

export type TweetContext = "parent" | "post" | "thread" | "reply";

export interface FxTweet {
  url?: string;
  id?: string;
  text?: string;
  created_at?: string;
  created_timestamp?: number;
  author?: FxAuthor;
  replies?: number;
  retweets?: number;
  reposts?: number;
  likes?: number;
  views?: number | null;
  bookmarks?: number;
  quotes?: number;
  lang?: string;
  source?: string;
  replying_to?: FxReplyingTo;
  replying_to_status?: string[] | null;
  possibly_sensitive?: boolean;
  media?: FxMedia;
  quote?: FxTweet;
  reposted_by?: FxAuthor | null;
  article?: FxArticle;
  poll?: FxPoll;
  community_note?: unknown;
  context?: TweetContext;
}

export interface FxCursor {
  top?: string;
  bottom?: string;
}

export interface FxListResponse<T> {
  results: T[];
  cursor?: FxCursor;
}

export type FxReplyRanking = "likes" | "recency";

export const getParentStatusId = (tweet: FxTweet): string | undefined => {
  const replyingTo = tweet.replying_to;
  if (replyingTo && !Array.isArray(replyingTo)) {
    const { status } = replyingTo;
    if (status) {
      return String(status);
    }
  }

  const fromStatus = tweet.replying_to_status?.[0];
  return fromStatus ? String(fromStatus) : undefined;
};
