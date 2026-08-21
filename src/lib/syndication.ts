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

interface Mp4Variant {
  bitrate?: number;
  content_type?: string;
  url: string;
}

const bestMp4Variants = (media: SyndicationMedia): Mp4Variant[] =>
  media.video_info?.variants
    ?.filter((variant): variant is Mp4Variant =>
      Boolean(variant.url && variant.content_type?.includes("video/mp4"))
    )
    .toSorted((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)) ?? [];

const buildVideoItem = (
  media: SyndicationMedia,
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

const buildPhotoItem = (media: SyndicationMedia): FxMediaItem | undefined => {
  const url = media.media_url_https ?? media.url;
  if (!url) {
    return undefined;
  }
  return { thumbnail_url: url, type: "photo", url };
};

const buildMediaItem = (media: SyndicationMedia): FxMediaItem | undefined => {
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

const dedupeMedia = (candidates: SyndicationMedia[]): SyndicationMedia[] => {
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

const mapMedia = (raw: SyndicationTweet): FxMedia | undefined => {
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

const mapArticle = (raw?: SyndicationArticle): FxArticle | undefined => {
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

const mapUser = (user?: SyndicationUser): FxTweet["author"] => {
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

const mapSyndicationTweet = (
  raw: SyndicationTweet,
  handle?: string,
  id?: string
): FxTweet => {
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
};

export const fetchSyndicationStatus = async (
  handle: string,
  id: string
): Promise<FxTweet> => {
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

  // SAFETY: the syndication endpoint answers with a tweet-result JSON
  // document; the text/article presence check below validates the shape.
  const data = (await response.json()) as SyndicationTweet;
  if (!data?.text && !data?.article) {
    throw new ConvertError(
      404,
      "Post not found via syndication API.",
      "syndication_empty"
    );
  }

  return mapSyndicationTweet(data, handle, id);
};
