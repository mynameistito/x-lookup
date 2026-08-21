import type { FxArticle, FxAuthor, FxMedia, FxMediaItem, FxTweet } from "./fxtwitter.js";
import type { OutputFormat } from "./output-format.js";
import type { UserinfoLevel } from "./query-modes.js";

export interface RenderOptions {
  format: OutputFormat;
  userinfo: UserinfoLevel;
  canonicalUrl: string;
  compact?: boolean;
}

const mediaItems = (media?: FxMedia): FxMediaItem[] => {
  if (!media) {
    return [];
  }
  if (media.all?.length) {
    return media.all;
  }
  return [
    ...(media.photos ?? []),
    ...(media.videos ?? []),
    ...(media.animated ?? []),
  ];
};

const variantLabel = (variant: {
  bitrate?: number;
  content_type?: string;
}): string => {
  if (variant.bitrate) {
    return `${variant.bitrate}bps`;
  }
  return variant.content_type ?? "MP4";
};

const variantLink = (variant: {
  bitrate?: number;
  content_type?: string;
  url: string;
}): string => `[${variantLabel(variant)}](${variant.url})`;

const videoDetails = (item: FxMediaItem): string[] => {
  const details = [
    item.duration_ms === undefined
      ? undefined
      : `duration: ${item.duration_ms}ms`,
    item.width !== undefined && item.height !== undefined
      ? `${item.width}×${item.height}`
      : undefined,
    item.bitrate === undefined ? undefined : `${item.bitrate}bps`,
  ].filter((part): part is string => Boolean(part));
  return details.length ? [`> Video: ${details.join(" · ")}`] : [];
};

const videoLines = (
  item: FxMediaItem,
  url?: string,
  thumb?: string
): string[] => {
  const lines: string[] = [];
  if (url) {
    lines.push(`> [video](${url})`);
  }
  if (thumb && thumb !== url) {
    lines.push(`> ![video thumbnail](${thumb})`);
  }
  lines.push(...videoDetails(item));
  const variants = item.variants?.filter((variant) => variant.url);
  if (variants?.length) {
    lines.push(`> Variants: ${variants.map(variantLink).join(" · ")}`);
  }
  return lines;
};

const mediaLines = (item: FxMediaItem): string[] => {
  const type = (item.type ?? "").toLowerCase();
  const url = item.url ?? item.thumbnail_url;
  const thumb = item.thumbnail_url ?? item.url;
  if (!url && !thumb) {
    return [];
  }
  if (type === "photo" || type === "image") {
    return [`> ![image](${url})`];
  }
  if (type === "video") {
    return videoLines(item, url, thumb);
  }
  if (type === "gif" || type === "animated_gif") {
    return [`> [animated_gif](${thumb ?? url})`];
  }
  return url ? [`> [media](${url})`] : [];
};

const renderMedia = (media?: FxMedia): string[] => {
  const lines: string[] = [];
  for (const item of mediaItems(media)) {
    lines.push(...mediaLines(item));
  }
  return lines;
};

const articleToMarkdown = (article: FxArticle): string[] => {
  const lines: string[] = [];
  if (article.title) {
    lines.push(`## ${article.title}`, "");
  }

  const cover = article.cover_media?.media_info?.original_img_url;
  if (cover) {
    lines.push(`![cover](${cover})`, "");
  }

  const blocks = article.content?.blocks ?? [];
  for (const block of blocks) {
    const text = block.text?.trim();
    if (!text) {
      continue;
    }
    if (block.type === "header-one") {
      lines.push(`# ${text}`);
    } else if (block.type === "header-two") {
      lines.push(`## ${text}`);
    } else if (block.type === "header-three") {
      lines.push(`### ${text}`);
    } else {
      lines.push(text);
    }
    lines.push("");
  }

  if (lines.length === 0 && article.preview_text) {
    lines.push(article.preview_text, "");
  }

  return lines;
};

const authorInfoBlock = (author: FxAuthor): string[] => {
  const lines: string[] = ["### Author", ""];
  if (author.name) {
    lines.push(`- **Name:** ${author.name}`);
  }
  if (author.screen_name) {
    lines.push(`- **Handle:** @${author.screen_name}`);
  }
  if (author.description) {
    lines.push(`- **Bio:** ${author.description}`);
  }
  if (author.location) {
    lines.push(`- **Location:** ${author.location}`);
  }
  if (author.website?.display_url || author.website?.url) {
    lines.push(
      `- **Website:** ${author.website.display_url ?? author.website.url}`
    );
  }
  if (author.followers !== undefined) {
    lines.push(`- **Followers:** ${author.followers.toLocaleString()}`);
  }
  if (author.following !== undefined) {
    lines.push(`- **Following:** ${author.following.toLocaleString()}`);
  }
  if (author.joined) {
    lines.push(`- **Joined:** ${author.joined}`);
  }
  lines.push("");
  return lines;
};

const statsLine = (tweet: FxTweet): string | undefined => {
  const parts: string[] = [];
  if (tweet.likes !== undefined) {
    parts.push(`${tweet.likes.toLocaleString()} likes`);
  }
  if (tweet.retweets !== undefined) {
    parts.push(`${tweet.retweets.toLocaleString()} reposts`);
  }
  if (tweet.replies !== undefined) {
    parts.push(`${tweet.replies.toLocaleString()} replies`);
  }
  if (tweet.views !== undefined && tweet.views !== null) {
    parts.push(`${tweet.views.toLocaleString()} views`);
  }
  return parts.length ? parts.join(" · ") : undefined;
};

const tweetUrl = (tweet: FxTweet, fallback?: string): string => {
  if (tweet.url) {
    return tweet.url;
  }
  const handle = tweet.author?.screen_name;
  const { id } = tweet;
  if (handle && id) {
    return `https://x.com/${handle}/status/${id}`;
  }
  return fallback ?? "Unavailable (post identity missing)";
};

const renderQuote = (quote: FxTweet): string[] => {
  const lines: string[] = ["> **Quoted post**", ">"];
  const author = quote.author?.name ?? quote.author?.screen_name ?? "Unknown";
  const handle = quote.author?.screen_name;
  const handleSuffix = handle ? ` @${handle}` : "";
  lines.push(`> **${author}**${handleSuffix}`);
  if (quote.text) {
    for (const line of quote.text.split("\n")) {
      lines.push(`> ${line}`);
    }
  }
  for (const mediaLine of renderMedia(quote.media)) {
    lines.push(`> ${mediaLine.replace(/^> /u, "")}`);
  }
  if (quote.quote) {
    for (const nestedLine of renderQuote(quote.quote)) {
      lines.push(`> ${nestedLine}`);
    }
  }
  lines.push(`> Source: ${tweetUrl(quote)}`, ">");
  return lines;
};

const obsidianPreamble = (
  tweet: FxTweet,
  author: string,
  handle: string | undefined,
  heading: string | null,
  index: number,
  source: string,
  total: number
): string[] => {
  const lines: string[] = [];
  if (index === 0) {
    const tags = ["twitter", "x"];
    if (handle) {
      tags.push(handle);
    }
    lines.push("---", `source: ${source}`, `author: ${author}`);
    if (handle) {
      lines.push(`author_handle: ${handle}`);
    }
    if (tweet.created_at) {
      lines.push(`published: ${tweet.created_at}`);
    }
    if (total > 1) {
      lines.push(`thread_posts: ${total}`);
    }
    lines.push(`tags: [${tags.join(", ")}]`, "---", "");
  }
  if (heading) {
    lines.push(heading, "");
  }
  return lines;
};

const fullHeader = (
  heading: string | null,
  author: string,
  handle?: string
): string[] => {
  if (heading) {
    return [heading, ""];
  }
  const lines = [`**${author}**`];
  if (handle) {
    lines.push(`@${handle}`);
  }
  lines.push("");
  return lines;
};

const contentLines = (tweet: FxTweet, includeAuthorMeta: boolean): string[] => {
  const lines: string[] = [];
  if (includeAuthorMeta && tweet.author) {
    lines.push(...authorInfoBlock(tweet.author));
  }
  if (tweet.article) {
    lines.push(...articleToMarkdown(tweet.article));
  }
  if (tweet.text?.trim()) {
    lines.push(tweet.text.trim(), "");
  }
  lines.push(...renderMedia(tweet.media));
  if (tweet.quote) {
    lines.push(...renderQuote(tweet.quote), "");
  }
  return lines;
};

const renderSingleTweet = (
  tweet: FxTweet,
  opts: RenderOptions,
  index: number,
  total: number,
  includeAuthorMeta: boolean
): string[] => {
  const author = tweet.author?.name ?? "Unknown";
  const handle = tweet.author?.screen_name;
  const source = tweetUrl(
    tweet,
    tweet.context === "post" || total === 1 ? opts.canonicalUrl : undefined
  );
  const relation = tweet.context
    ? (
        {
          parent: "Parent",
          post: "Post",
          reply: "Reply",
          thread: "Thread",
        } as const
      )[tweet.context]
    : undefined;
  const relationPrefix = relation ? `${relation} · ` : "";
  const handleSuffix = handle ? ` (@${handle})` : "";
  const boldLabel = `${relationPrefix}${author}${handleSuffix}`;
  const headingLabel = `${relationPrefix}${index + 1}/${total} — ${boldLabel}`;
  const heading = total > 1 || relation ? `## ${headingLabel}` : null;
  const lines: string[] = [];

  if (opts.format === "obsidian") {
    lines.push(
      ...obsidianPreamble(tweet, author, handle, heading, index, source, total)
    );
  } else if (opts.compact) {
    lines.push(...(heading ? [heading, ""] : [`**${boldLabel}**`, ""]));
  } else {
    lines.push(...fullHeader(heading, author, handle), `Source: ${source}`);
    if (tweet.created_at) {
      lines.push(`Date: ${tweet.created_at}`);
    }
    const stats = statsLine(tweet);
    if (stats) {
      lines.push(`Stats: ${stats}`);
    }
    lines.push("");
  }

  lines.push(...contentLines(tweet, includeAuthorMeta));

  if (opts.compact && opts.format !== "obsidian") {
    lines.push(`Source: ${source}`);
  }

  return lines;
};

export const renderThreadMarkdown = (
  tweets: FxTweet[],
  opts: RenderOptions
): string => {
  const lines: string[] = [];
  const seenAuthors = new Set<string>();

  for (let index = 0; index < tweets.length; index += 1) {
    const tweet = tweets[index];
    const handle = tweet.author?.screen_name ?? "";
    let includeAuthorMeta = false;

    if (opts.userinfo === "author" && index === 0 && tweet.author) {
      includeAuthorMeta = true;
    } else if (
      opts.userinfo === "all" &&
      tweet.author &&
      handle &&
      !seenAuthors.has(handle)
    ) {
      seenAuthors.add(handle);
      includeAuthorMeta = true;
    }

    lines.push(
      ...renderSingleTweet(tweet, opts, index, tweets.length, includeAuthorMeta)
    );
    if (index < tweets.length - 1) {
      lines.push("---", "");
    }
  }

  return lines.join("\n").trim();
};
