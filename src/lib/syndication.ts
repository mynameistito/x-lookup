import { ConvertError } from "./errors.js";
import type {
  FxArticle,
  FxArticleBlock,
  FxMedia,
  FxMediaItem,
  FxTweet,
} from "./fxtwitter.js";

const SYNDICATION_BASE = "https://cdn.syndication.twimg.com/tweet-result";
const UA = "Mozilla/5.0 (compatible; x-lookup/1.0)";

interface SyndicationUser {
  name?: string;
  screen_name?: string;
  profile_image_url_https?: string;
  description?: string;
  location?: string;
  followers_count?: number;
  friends_count?: number;
  statuses_count?: number;
  created_at?: string;
  verified?: boolean;
  url?: string;
  entities?: {
    url?: { urls?: { display_url?: string; expanded_url?: string }[] };
  };
}

interface SyndicationMedia {
  type?: string;
  media_url_https?: string;
  url?: string;
  original_info?: { width?: number; height?: number };
  sizes?: { large?: { w?: number; h?: number } };
  video_info?: {
    duration_millis?: number;
    aspect_ratio?: [number, number];
    variants?: { url?: string; content_type?: string; bitrate?: number }[];
  };
}

interface SyndicationArticle {
  title?: string;
  preview_text?: string;
  cover_media?: { media_info?: { original_img_url?: string } };
}

interface SyndicationTweet {
  id_str?: string;
  text?: string;
  created_at?: string;
  favorite_count?: number;
  conversation_count?: number;
  lang?: string;
  user?: SyndicationUser;
  mediaDetails?: SyndicationMedia[];
  photos?: SyndicationMedia[];
  video?: SyndicationMedia;
  quoted_status_result?: {
    result?: { legacy?: SyndicationTweet; tweet?: SyndicationTweet };
  };
  quoted_tweet?: SyndicationTweet;
  article?: SyndicationArticle;
  entities?: { media?: SyndicationMedia[] };
}

function mapMedia(raw: SyndicationTweet): FxMedia | undefined {
  const fallbackItems = [
    ...(raw.photos ?? []),
    ...(raw.video ? [raw.video] : []),
    ...(raw.entities?.media ?? []),
  ];
  const candidates = raw.mediaDetails?.length
    ? raw.mediaDetails
    : fallbackItems;
  const seenMedia = new Set<string>();
  const items = candidates.filter((item) => {
    const key =
      item.media_url_https ?? item.url ?? item.video_info?.variants?.[0]?.url;
    if (!key || seenMedia.has(key)) {
      return false;
    }
    seenMedia.add(key);
    return true;
  });
  if (items.length === 0) {
    return undefined;
  }

  const photos: FxMediaItem[] = [];
  const videos: FxMediaItem[] = [];
  const animated: FxMediaItem[] = [];

  for (const m of items) {
    const type = (m.type ?? "photo").toLowerCase();
    const photoUrl = m.media_url_https ?? m.url;
    const videoVariant = m.video_info?.variants
      ?.filter((v) => v.content_type?.includes("video/mp4"))
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    const variants = m.video_info?.variants
      ?.filter(
        (v): v is { url: string; content_type?: string; bitrate?: number } =>
          Boolean(v.url && v.content_type?.includes("video/mp4"))
      )
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    const width = m.original_info?.width ?? m.sizes?.large?.w;
    const height = m.original_info?.height ?? m.sizes?.large?.h;

    if (type === "photo") {
      if (photoUrl) {
        photos.push({ thumbnail_url: photoUrl, type: "photo", url: photoUrl });
      }
    } else if (type === "video") {
      videos.push({
        bitrate: videoVariant?.bitrate,
        duration_ms: m.video_info?.duration_millis,
        height,
        thumbnail_url: photoUrl,
        type: "video",
        url: videoVariant?.url ?? photoUrl,
        variants,
        width,
      });
    } else if (type === "animated_gif") {
      animated.push({
        bitrate: videoVariant?.bitrate,
        duration_ms: m.video_info?.duration_millis,
        height,
        thumbnail_url: photoUrl,
        type: "animated_gif",
        url: videoVariant?.url ?? photoUrl,
        variants,
        width,
      });
    }
  }

  const media: FxMedia = {};
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
}

function mapArticle(raw?: SyndicationArticle): FxArticle | undefined {
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
}

function mapUser(user?: SyndicationUser): FxTweet["author"] {
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
}

function mapSyndicationTweet(
  raw: SyndicationTweet,
  handle?: string,
  id?: string
): FxTweet {
  const screenName = raw.user?.screen_name ?? handle;
  const ownId = raw.id_str ?? id;
  const quoted =
    raw.quoted_tweet ??
    raw.quoted_status_result?.result?.legacy ??
    raw.quoted_status_result?.result?.tweet;

  return {
    article: mapArticle(raw.article),
    author: mapUser(raw.user),
    created_at: raw.created_at,
    id: ownId,
    lang: raw.lang,
    likes: raw.favorite_count,
    media: mapMedia(raw),
    quote: quoted ? mapSyndicationTweet(quoted) : undefined,
    replies: raw.conversation_count,
    text: raw.text,
    url:
      screenName && ownId
        ? `https://x.com/${screenName}/status/${ownId}`
        : undefined,
  };
}

export async function fetchSyndicationStatus(
  handle: string,
  id: string
): Promise<FxTweet> {
  let response: Response;
  try {
    const url = `${SYNDICATION_BASE}?id=${encodeURIComponent(id)}&lang=en&token=0`;
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
  } catch {
    throw new ConvertError(
      502,
      "Failed to reach X syndication API.",
      "syndication_network"
    );
  }

  if (!response.ok) {
    throw new ConvertError(
      response.status === 404 ? 404 : 502,
      "Post not found via syndication API.",
      "syndication_error"
    );
  }

  const data = (await response.json()) as SyndicationTweet;
  if (!data?.text && !data?.article) {
    throw new ConvertError(
      404,
      "Post not found via syndication API.",
      "syndication_empty"
    );
  }

  return mapSyndicationTweet(data, handle, id);
}
