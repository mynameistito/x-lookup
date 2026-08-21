import { ConvertError } from "./errors.js";

const FX_BASE = "https://api.fxtwitter.com";
const UA = "x-lookup/1.0";
const MAX_CHAIN_DEPTH = 100;

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
  /** Normalized duration. FxTwitter sends seconds; syndication sends milliseconds. */
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
  cover_media?: {
    media_info?: { original_img_url?: string };
  };
}

/** FxTwitter may return a single parent object or legacy string[] handles. */
export type FxReplyingTo =
  | string[]
  | {
      screen_name?: string;
      status?: string;
      url?: string;
      profile_url?: string;
    }
  | null;

/** How a post relates to the status requested by the caller. */
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

interface FxApiResponse {
  code?: number;
  message?: string;
  tweet?: FxTweet;
  status?: FxTweet;
  thread?: FxTweet[];
}

interface FxConversationResponse {
  results?: FxTweet[];
  tweets?: FxTweet[];
  conversation?: FxTweet[];
  replies?: FxTweet[] | null;
}

export interface FxCursor {
  top?: string;
  bottom?: string;
}

export interface FxListResponse<T> {
  results: T[];
  cursor?: FxCursor;
}

const CONTAINER_CONTENT_TYPES = new Map([
  ["m3u8", "application/vnd.apple.mpegurl"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
]);

const containerContentType = (container?: string): string | undefined => {
  if (!container) {
    return undefined;
  }
  if (container.includes("/")) {
    return container;
  }
  return CONTAINER_CONTENT_TYPES.get(container);
};

const durationToMs = (duration: number | undefined): number | undefined =>
  duration === undefined ? undefined : duration * 1000;

const normalizeMediaItem = (item: FxMediaItem): FxMediaItem => {
  const formatVariants = item.formats
    ?.filter((format) => format.url)
    .map((format) => ({
      bitrate: format.bitrate,
      content_type: containerContentType(format.container),
      url: format.url,
    }));
  return {
    ...item,
    alt: item.alt ?? item.altText,
    duration_ms: item.duration_ms ?? durationToMs(item.duration),
    variants: item.variants ?? formatVariants,
  };
};

const normalizeMedia = (media?: FxMedia): FxMedia | undefined => {
  if (!media || Object.keys(media).length === 0) {
    return undefined;
  }
  const map = (items?: FxMediaItem[]) => items?.map(normalizeMediaItem);
  return {
    ...media,
    all: map(media.all),
    animated: map(media.animated),
    mosaic: media.mosaic
      ? { ...media.mosaic, photos: map(media.mosaic.photos) }
      : undefined,
    photos: map(media.photos),
    videos: map(media.videos),
  };
};

const normalizeTweet = (raw: FxTweet): FxTweet => ({
  ...raw,
  media: normalizeMedia(raw.media),
  quote: raw.quote ? normalizeTweet(raw.quote) : undefined,
  retweets: raw.retweets ?? raw.reposts,
});

const pickTweet = (data: FxApiResponse): FxTweet | undefined => {
  const raw = data.status ?? data.tweet;
  return raw ? normalizeTweet(raw) : undefined;
};

const fxFetchJson = async <T>(path: string): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${FX_BASE}/${path}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
  } catch {
    throw new ConvertError(
      502,
      "Failed to reach FxTwitter API.",
      "fxtwitter_network"
    );
  }

  let data: FxApiResponse & T;
  try {
    // SAFETY: FxTwitter API paths answer with a JSON envelope; non-JSON
    // bodies are rejected by the parse guard around this assignment.
    data = (await response.json()) as FxApiResponse & T;
  } catch {
    throw new ConvertError(
      502,
      "FxTwitter API returned a non-JSON response.",
      "fxtwitter_error"
    );
  }

  if (data.code === 404 || data.message === "NOT_FOUND") {
    throw new ConvertError(404, "Post not found or unavailable.", "not_found");
  }

  if (data.message === "PRIVATE_TWEET") {
    throw new ConvertError(
      404,
      "Post is private and cannot be fetched.",
      "private_tweet"
    );
  }

  if (!response.ok || (data.code && data.code >= 400)) {
    throw new ConvertError(
      502,
      `FxTwitter API error: ${data.message ?? response.status}.`,
      "fxtwitter_error"
    );
  }

  // SAFETY: the envelope was parsed as FxApiResponse & T; T is the payload
  // carried by that same envelope object.
  return data as T;
};

const fxFetch = (path: string): Promise<FxApiResponse> =>
  fxFetchJson<FxApiResponse>(path);

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

export const fetchFxProfile = async (handle: string): Promise<FxAuthor> => {
  const data = await fxFetchJson<{ user?: FxAuthor }>(
    `2/profile/${encodeURIComponent(handle)}`
  );
  if (!data.user) {
    throw new ConvertError(404, "Profile not found.", "not_found");
  }
  return data.user;
};

export const fetchFxProfileStatuses = async (
  handle: string,
  cursor?: string,
  count = 20
): Promise<FxListResponse<FxTweet>> => {
  const query = encodeQuery({ count, cursor, with_replies: "false" });
  const data = await fxFetchJson<Partial<FxListResponse<FxTweet>>>(
    `2/profile/${encodeURIComponent(handle)}/statuses?${query}`
  );
  return {
    cursor: data.cursor,
    results: (data.results ?? []).map(normalizeTweet),
  };
};

/**
 * Search via FxTwitter. FxTwitter refuses some datacenter egress IPs with a
 * NOT_FOUND body; that must surface as 502 `search_unavailable`, never a fake
 * "post not found".
 */
export const searchFxStatuses = async (
  queryText: string,
  feed: string,
  cursor?: string,
  count = 20
): Promise<FxListResponse<FxTweet>> => {
  const query = encodeQuery({ count, cursor, feed, q: queryText });
  try {
    const data = await fxFetchJson<Partial<FxListResponse<FxTweet>>>(
      `2/search?${query}`
    );
    return {
      cursor: data.cursor,
      results: (data.results ?? []).map(normalizeTweet),
    };
  } catch (error) {
    if (error instanceof ConvertError && error.code === "not_found") {
      throw new ConvertError(
        502,
        "X search is unavailable upstream.",
        "search_unavailable"
      );
    }
    throw error;
  }
};

export const fetchFxConnections = async (
  handle: string,
  relation: "followers" | "following",
  cursor?: string,
  count = 20
): Promise<FxListResponse<FxAuthor>> => {
  const query = encodeQuery({ count, cursor });
  const data = await fxFetchJson<Partial<FxListResponse<FxAuthor>>>(
    `2/profile/${encodeURIComponent(handle)}/${relation}?${query}`
  );
  return { cursor: data.cursor, results: data.results ?? [] };
};

export const fetchFxStatus = async (id: string): Promise<FxTweet> => {
  const data = await fxFetch(`2/status/${id}`);
  const tweet = pickTweet(data);
  if (!tweet) {
    throw new ConvertError(404, "Post not found.", "not_found");
  }
  return tweet;
};

export const getParentStatusId = (tweet: FxTweet): string | undefined => {
  const replyingTo = tweet.replying_to;
  if (replyingTo && !Array.isArray(replyingTo)) {
    const { status } = replyingTo;
    if (status) {
      return String(status);
    }
  }

  const fromStatus = tweet.replying_to_status?.[0];
  if (fromStatus) {
    return String(fromStatus);
  }

  return undefined;
};

const walkParentChain = async (
  currentId: string,
  walked: FxTweet[],
  seen: Set<string>
): Promise<FxTweet[]> => {
  if (seen.has(currentId) || walked.length >= MAX_CHAIN_DEPTH) {
    return walked.toReversed();
  }
  seen.add(currentId);
  try {
    const tweet = await fetchFxStatus(currentId);
    walked.push(tweet);
    const parentId = getParentStatusId(tweet);
    return parentId
      ? walkParentChain(parentId, walked, seen)
      : walked.toReversed();
  } catch (error) {
    if (error instanceof ConvertError && error.code === "private_tweet") {
      throw error;
    }
    return walked.toReversed();
  }
};

/** Walk parent replies from root through the given status id (inclusive). */
export const fetchFxConversationChain = (id: string): Promise<FxTweet[]> =>
  walkParentChain(id, [], new Set());

export const fetchFxThread = async (id: string): Promise<FxTweet[]> => {
  const data = await fxFetch(`2/thread/${id}`);
  if (data.thread?.length) {
    return data.thread.map(normalizeTweet);
  }
  return [await fetchFxStatus(id)];
};

export type FxReplyRanking = "likes" | "recency";

const tweetTimestamp = (tweet: FxTweet): number => {
  const { created_timestamp: timestamp } = tweet;
  return timestamp === undefined
    ? Date.parse(tweet.created_at ?? "") || 0
    : timestamp;
};

/** Fetch ranked replies from FxTwitter's v2 conversation endpoint. */
export const fetchFxConversationReplies = async (
  id: string,
  rankingMode: FxReplyRanking = "likes",
  limit = 10
): Promise<FxTweet[]> => {
  const query = encodeQuery({ ranking_mode: rankingMode });
  const data = await fxFetchJson<FxConversationResponse>(
    `2/conversation/${encodeURIComponent(id)}?${query}`
  );
  const primary = data.replies ?? data.results;
  const replies = primary ?? data.tweets ?? data.conversation;
  const ranked = (replies ?? [])
    .map(normalizeTweet)
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
    });
  return ranked.slice(0, limit);
};

/**
 * Full thread: FxTwitter thread endpoint (author threads + reply chains), with a
 * parent-walk fallback when the endpoint returns only the requested status.
 */
export const fetchFxFullThread = async (id: string): Promise<FxTweet[]> => {
  const fromThread = await fetchFxThread(id);
  if (fromThread.length > 1) {
    return fromThread;
  }

  const tweet = fromThread[0] ?? (await fetchFxStatus(id));
  if (!getParentStatusId(tweet)) {
    return [tweet];
  }

  const chain = await fetchFxConversationChain(id);
  return chain.length > 0 ? chain : [tweet];
};
