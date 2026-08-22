import type { ConvertSuccess } from "@/lib/converter.ts";
import type {
  FxMedia,
  FxMediaItem,
  FxPoll,
  FxTweet,
} from "@/lib/fxtwitter-types.ts";
import type { HeaderMap, HttpPayload } from "@/lib/http.ts";

export const SITE_NAME = "x-lookup";
export const THEME_COLOR = "#146c43";

/** Social preview crawlers that should receive Open Graph HTML. */
export const EMBED_UA_REGEX =
  /discordbot|telegrambot|slackbot|slack-img|whatsapp|facebookexternalhit|facebot|linkedinbot|skypeuripreview|vkshare|pinterest|redditbot|embedly|iframely|steamchaturllookup|revoltchat|matrixpreviewbot/iu;

export const NATIVE_MULTI_IMAGE_UA_REGEX = /discordbot|matrixpreviewbot/iu;

export const isEmbedUserAgent = (userAgent: string): boolean =>
  EMBED_UA_REGEX.test(userAgent);

export const supportsNativeMultiImage = (userAgent: string): boolean =>
  NATIVE_MULTI_IMAGE_UA_REGEX.test(userAgent);

export interface EmbedOptions {
  origin: string;
  userAgent?: string;
}

export interface OEmbedQuery {
  url?: string | null;
  text?: string | null;
  author?: string | null;
  status?: string | null;
  provider?: string | null;
}

export interface OEmbedPayload {
  author_name: string;
  author_url: string;
  provider_name: string;
  provider_url: string;
  title: string;
  type: string;
  version: string;
}

const escapeAttr = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const publishedTime = (tweet: FxTweet): string | undefined => {
  const timestamp = tweet.created_timestamp;
  if (timestamp === undefined) {
    const date = new Date(tweet.created_at ?? "");
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const milliseconds =
    timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const formatCount = (num: number): string => {
  if (num >= 1e6) {
    return `${(num / 1e6).toFixed(2)}M`;
  }
  if (num >= 995_000) {
    return "1.00M";
  }
  if (num >= 1e3) {
    return `${(num / 1e3).toFixed(1)}K`;
  }
  return String(num);
};

export const socialProof = (tweet: FxTweet): string | undefined => {
  const parts: string[] = [];
  if ((tweet.replies ?? 0) > 0) {
    parts.push(`💬 ${formatCount(tweet.replies ?? 0)}`);
  }
  if ((tweet.retweets ?? 0) > 0) {
    parts.push(`🔁 ${formatCount(tweet.retweets ?? 0)}`);
  }
  if ((tweet.likes ?? 0) > 0) {
    parts.push(`❤️ ${formatCount(tweet.likes ?? 0)}`);
  }
  if ((tweet.views ?? 0) > 0) {
    parts.push(`👁️ ${formatCount(tweet.views ?? 0)}`);
  }
  return parts.length ? parts.join("   ") : undefined;
};

const quoteBlock = (quote: FxTweet): string => {
  const name = quote.author?.name ?? "Unknown";
  const handle = quote.author?.screen_name;
  const header = handle ? `Quoting ${name} (@${handle})` : `Quoting ${name}`;
  const text = quote.text?.trim();
  return text ? `\n${header}\n\n${text}` : `\n${header}`;
};

const voteNoun = (count: number): string => (count === 1 ? "vote" : "votes");

const pollBlock = (poll: FxPoll, barLength = 32): string => {
  const lines: string[] = [""];
  for (const choice of poll.choices ?? []) {
    const pct = choice.percentage ?? 0;
    const bar = "█".repeat(Math.round((pct / 100) * barLength));
    const label = choice.label ?? "";
    lines.push(bar, `${label}\u2000\u2000(${pct}%)`);
  }
  const votes = poll.total_votes;
  const timeLeft = poll.time_left_en;
  const voteLabel =
    votes === undefined ? undefined : `${votes} ${voteNoun(votes)}`;
  const footer = [voteLabel, timeLeft]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  if (footer) {
    lines.push("", footer);
  }
  return `\n${lines.join("\n")}`;
};

export const embedDescription = (tweet: FxTweet): string => {
  let text = tweet.text ?? "";
  if (tweet.poll && Array.isArray(tweet.poll.choices)) {
    text += pollBlock(tweet.poll);
  }
  if (tweet.quote) {
    text += quoteBlock(tweet.quote);
  }
  return text;
};

export const pickFocalTweet = (
  posts: FxTweet[],
  requestedId?: string
): FxTweet | undefined => {
  if (requestedId) {
    const match = posts.find((post) => post.id === requestedId);
    if (match) {
      return match;
    }
  }
  return posts.find((post) => post.context === "post") ?? posts[0];
};

const isPlayableMp4 = (url: string, contentType?: string): boolean => {
  if (contentType === "video/mp4") {
    return true;
  }
  return /\.mp4(?:$|[?#])/iu.test(url);
};

const bestVideoUrl = (item: FxMediaItem): string | undefined => {
  const [best] = (item.variants ?? [])
    .filter(
      (variant) =>
        Boolean(variant.url) && isPlayableMp4(variant.url, variant.content_type)
    )
    .toSorted((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (best?.url) {
    return best.url;
  }
  if (item.url && isPlayableMp4(item.url, item.format)) {
    return item.url;
  }
  return undefined;
};

interface Dimensions {
  height: number;
  width: number;
}

const videoDimensions = (item: FxMediaItem): Dimensions => {
  let width = item.width ?? 1280;
  let height = item.height ?? 720;
  if (width > 1920 || height > 1920) {
    width = Math.round(width / 2);
    height = Math.round(height / 2);
  } else if (width < 400 && height < 400) {
    width *= 2;
    height *= 2;
  }
  return { height, width };
};

const firstVideo = (media?: FxMedia): FxMediaItem | undefined =>
  media?.videos?.[0] ?? media?.animated?.[0];

const mosaicUrl = (media?: FxMedia): string | undefined =>
  media?.mosaic?.formats?.jpeg ?? media?.mosaic?.formats?.webp;

const photoTags = (photo: FxMediaItem): string[] => {
  if (!photo.url) {
    return [];
  }
  const tags = [
    `<meta property="twitter:image" content="${escapeAttr(photo.url)}">`,
    `<meta property="og:image" content="${escapeAttr(photo.url)}">`,
  ];
  if (photo.width !== undefined && photo.height !== undefined) {
    const w = String(photo.width);
    const h = String(photo.height);
    tags.push(
      `<meta property="twitter:image:width" content="${w}">`,
      `<meta property="twitter:image:height" content="${h}">`,
      `<meta property="og:image:width" content="${w}">`,
      `<meta property="og:image:height" content="${h}">`
    );
  }
  const alt = photo.alt ?? photo.altText;
  if (alt) {
    tags.push(
      `<meta property="twitter:image:alt" content="${escapeAttr(alt)}">`,
      `<meta property="og:image:alt" content="${escapeAttr(alt)}">`
    );
  }
  return tags;
};

const videoTags = (video: FxMediaItem): string[] => {
  const url = bestVideoUrl(video);
  if (!url) {
    return [];
  }
  const { width, height } = videoDimensions(video);
  const mime = video.format?.includes("/") ? video.format : "video/mp4";
  const thumb = video.thumbnail_url;
  const tags = [
    `<meta property="twitter:player:width" content="${width}">`,
    `<meta property="twitter:player:height" content="${height}">`,
    `<meta property="twitter:player:stream" content="${escapeAttr(url)}">`,
    `<meta property="twitter:player:stream:content_type" content="${escapeAttr(mime)}">`,
    `<meta property="og:video" content="${escapeAttr(url)}">`,
    `<meta property="og:video:secure_url" content="${escapeAttr(url)}">`,
    `<meta property="og:video:type" content="${escapeAttr(mime)}">`,
    `<meta property="og:video:width" content="${width}">`,
    `<meta property="og:video:height" content="${height}">`,
  ];
  if (thumb) {
    tags.push(
      `<meta property="og:image" content="${escapeAttr(thumb)}">`,
      '<meta property="twitter:image" content="0">'
    );
  }
  return tags;
};

interface MediaPlan {
  card: "summary" | "summary_large_image" | "player";
  tags: string[];
}

const stillImagePlan = (
  item: FxMediaItem | undefined
): MediaPlan | undefined => {
  const url = item?.thumbnail_url ?? item?.url;
  if (!url || /\.m3u8(?:$|[?#])/iu.test(url)) {
    return undefined;
  }
  return {
    card: "summary_large_image",
    tags: [
      `<meta property="twitter:image" content="${escapeAttr(url)}">`,
      `<meta property="og:image" content="${escapeAttr(url)}">`,
    ],
  };
};

const videoPlan = (
  video: FxMediaItem,
  staticVideoFallback: boolean
): MediaPlan | undefined => {
  if (staticVideoFallback && video.thumbnail_url) {
    const still = stillImagePlan(video);
    if (still) {
      return still;
    }
  }
  if (bestVideoUrl(video)) {
    return { card: "player", tags: videoTags(video) };
  }
  return stillImagePlan(video);
};

const mosaicTags = (mosaic: string): string[] => [
  `<meta property="twitter:image" content="${escapeAttr(mosaic)}">`,
  `<meta property="og:image" content="${escapeAttr(mosaic)}">`,
];

const imagePlan = (
  mosaic: string | undefined,
  photos: FxMediaItem[],
  multiImage: boolean
): MediaPlan | undefined => {
  if (photos.length > 1 && multiImage) {
    return { card: "summary_large_image", tags: photos.flatMap(photoTags) };
  }
  if (mosaic && photos.length > 1) {
    return { card: "summary_large_image", tags: mosaicTags(mosaic) };
  }
  const [first] = photos;
  return first
    ? { card: "summary_large_image", tags: photoTags(first) }
    : undefined;
};

const mediaPlan = (
  tweet: FxTweet,
  multiImage: boolean,
  staticVideoFallback: boolean
): MediaPlan => {
  const own = tweet.media;
  const quoted = tweet.quote?.media;
  const video = firstVideo(own) ?? firstVideo(quoted);
  if (video) {
    const plan = videoPlan(video, staticVideoFallback);
    if (plan) {
      return plan;
    }
  }

  const ownPhotos = (own?.photos ?? []).filter((photo) => photo.url);
  const ownPlan = imagePlan(mosaicUrl(own), ownPhotos, multiImage);
  if (ownPlan) {
    return ownPlan;
  }

  const quotedPhotos = (quoted?.photos ?? []).filter((photo) => photo.url);
  const quotedPlan = imagePlan(mosaicUrl(quoted), quotedPhotos, multiImage);
  if (quotedPlan) {
    return quotedPlan;
  }

  const avatar = tweet.author?.avatar_url;
  if (avatar) {
    return {
      card: "summary",
      tags: [
        `<meta property="og:image" content="${escapeAttr(avatar)}">`,
        '<meta property="twitter:image" content="0">',
        `<link rel="apple-touch-icon" href="${escapeAttr(avatar)}">`,
      ],
    };
  }
  return { card: "summary", tags: [] };
};

export const buildEmbedHtml = (
  tweet: FxTweet,
  options: EmbedOptions
): string => {
  const handle = tweet.author?.screen_name ?? "i";
  const name = tweet.author?.name ?? handle;
  const id = tweet.id ?? "0";
  const canonical = tweet.url ?? `https://x.com/${handle}/status/${id}`;
  const title = `${name} (@${handle})`;
  const description = embedDescription(tweet);
  const proof = socialProof(tweet) ?? "Embed";
  const authorUrl =
    tweet.author?.url ?? `https://x.com/${encodeURIComponent(handle)}`;
  const published = publishedTime(tweet);
  const userAgent = options.userAgent ?? "";
  const multiImage = supportsNativeMultiImage(userAgent);
  const media = mediaPlan(
    tweet,
    multiImage,
    /slackbot|slack-img/iu.test(userAgent)
  );
  const oembed = new URL("/oembed", options.origin);
  oembed.searchParams.set("url", canonical);
  oembed.searchParams.set("text", proof.slice(0, 255));
  oembed.searchParams.set("status", id);
  oembed.searchParams.set("author", handle);
  if (media.card === "player" && proof !== "Embed") {
    oembed.searchParams.set("provider", proof);
  }

  const tags = [
    `<link rel="canonical" href="${escapeAttr(canonical)}">`,
    `<meta property="og:url" content="${escapeAttr(canonical)}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    '<meta property="og:type" content="article">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="article:author" content="${escapeAttr(authorUrl)}">`,
    `<meta name="theme-color" content="${THEME_COLOR}">`,
    `<meta property="twitter:card" content="${media.card}">`,
    `<meta property="twitter:title" content="${escapeAttr(title)}">`,
    `<meta property="twitter:site" content="@${escapeAttr(handle)}">`,
    `<meta property="twitter:creator" content="@${escapeAttr(handle)}">`,
    ...media.tags,
    `<link rel="alternate" type="application/json+oembed" href="${escapeAttr(oembed.toString())}" title="${escapeAttr(name)}">`,
  ];
  if (published) {
    tags.splice(
      5,
      0,
      `<meta property="article:published_time" content="${published}">`
    );
  }

  return `<!doctype html>
<html lang="${escapeAttr(tweet.lang ?? "en")}">
<head>
${tags.join("\n")}
</head>
<body></body>
</html>`;
};

export const embedResponse = (
  result: ConvertSuccess,
  options: EmbedOptions
): HttpPayload => {
  const match = /\/status\/(?<id>\d+)/u.exec(result.canonicalUrl);
  const requestedId = match?.groups?.id;
  const tweet = pickFocalTweet(result.posts, requestedId);
  if (!tweet) {
    return {
      body: JSON.stringify({
        code: "not_found",
        error: "Post not found or unavailable.",
      }),
      headers: { "Content-Type": "application/json; charset=utf-8" },
      status: 404,
    };
  }

  const headers: HeaderMap = {
    "Content-Type": "text/html; charset=utf-8",
    Vary: "Accept, User-Agent",
    "X-Cache": result.cache.toUpperCase(),
    "X-Converter": "x-lookup",
    "X-Embed": "1",
    "X-Post-Count": String(result.postCount),
    "X-Source": result.source,
    "X-Warnings": String(result.warnings.length),
  };
  if (result.cache !== "bypass") {
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
  }

  return { body: buildEmbedHtml(tweet, options), headers, status: 200 };
};

const parseStatusUrlSafe = (
  raw: string
): { handle: string; id: string; canonicalUrl: string } | undefined => {
  try {
    const parsed = new URL(raw);
    const match = /^\/(?<handle>[^/?#]+)\/status\/(?<id>\d+)\/?$/u.exec(
      parsed.pathname
    );
    const { handle = "", id = "" } = match?.groups ?? {};
    if (!handle || !id) {
      return undefined;
    }
    return {
      canonicalUrl: `https://x.com/${handle}/status/${id}`,
      handle,
      id,
    };
  } catch {
    return undefined;
  }
};

export const oembedPayload = (
  query: OEmbedQuery,
  origin: string
): OEmbedPayload => {
  const fromUrl = query.url ? parseStatusUrlSafe(query.url) : undefined;
  const author = fromUrl?.handle || query.author || "i";
  const status = fromUrl?.id || query.status || "0";
  const statusUrl =
    fromUrl?.canonicalUrl ??
    `https://x.com/${encodeURIComponent(author)}/status/${status}`;
  return {
    author_name: query.text || "Embed",
    author_url: statusUrl,
    provider_name: query.provider || SITE_NAME,
    provider_url: query.provider ? statusUrl : origin,
    title: "Embed",
    type: query.provider ? "rich" : "link",
    version: "1.0",
  };
};

export const oembedResponse = (
  query: OEmbedQuery,
  origin: string
): HttpPayload => ({
  body: JSON.stringify(oembedPayload(query, origin)),
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "application/json; charset=utf-8",
  },
  status: 200,
});
