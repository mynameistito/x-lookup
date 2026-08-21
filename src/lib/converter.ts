import {
  buildCacheKey,
  cacheControlHeader,
  memoryConfig,
  withCache,
} from "./cache.js";
import type { CacheStatus, RuntimeConfig } from "./cache.js";
import { ConvertError } from "./errors.js";
import type { FxTweet } from "./fxtwitter.js";
import type { HeaderMap, HttpPayload } from "./http.js";
import { renderThreadMarkdown } from "./markdown.js";
import type { UserinfoLevel } from "./markdown.js";
import { fetchPosts } from "./tweet-fetch.js";
import type { ContextMode, FetchSource, RepliesMode } from "./tweet-fetch.js";

export { ConvertError } from "./errors.js";

export type OutputFormat = "markdown" | "obsidian" | "json";

export interface ConvertInput {
  url?: string | null;
  handle?: string | null;
  id?: string | null;
  format?: string | null;
  thread?: string | null;
  userinfo?: string | null;
  nocache?: boolean | string | null;
  full?: boolean | string | null;
  context?: string | null;
  replies?: string | null;
}

export interface ConvertSuccess {
  body: string;
  warnings: string[];
  canonicalUrl: string;
  format: OutputFormat;
  postCount: number;
  source: FetchSource;
  cache: CacheStatus;
  posts: FxTweet[];
  compact: boolean;
}

export interface StatusTarget {
  canonicalUrl: string;
  handle: string;
  id: string;
}

const ALLOWED_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x-lookup.mynameistito.com",
]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const STATUS_PATH = /^\/(?<handle>[^/?#]+)\/status\/(?<id>\d+)\/?$/u;

const hostAllowed = (host: string): boolean =>
  ALLOWED_HOSTS.has(host) ||
  LOCAL_HOSTS.has(host) ||
  host.endsWith(".workers.dev");

export const parseStatusUrl = (raw: string): StatusTarget => {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ConvertError(
      400,
      "Invalid URL. Provide a public X/Twitter status URL.",
      "invalid_url"
    );
  }

  const host = parsed.hostname.replace(/^www\./u, "");

  if (!hostAllowed(host)) {
    throw new ConvertError(
      400,
      "Only x.com or twitter.com status URLs are supported.",
      "unsupported_host"
    );
  }

  const match = STATUS_PATH.exec(parsed.pathname);
  if (!match) {
    throw new ConvertError(
      400,
      "URL must be a status permalink like https://x.com/handle/status/1234567890.",
      "invalid_path"
    );
  }

  const { handle = "", id = "" } = match.groups ?? {};
  return {
    canonicalUrl: `https://x.com/${handle}/status/${id}`,
    handle,
    id,
  };
};

export const resolveTarget = (input: ConvertInput): StatusTarget => {
  if (input.url) {
    return parseStatusUrl(input.url);
  }

  if (input.handle && input.id) {
    const handle = input.handle.replace(/^@/u, "");
    const id = input.id.replaceAll(/\D/gu, "");
    if (!handle || !id) {
      throw new ConvertError(
        400,
        "Missing or invalid handle/status id.",
        "invalid_params"
      );
    }
    return {
      canonicalUrl: `https://x.com/${handle}/status/${id}`,
      handle,
      id,
    };
  }

  throw new ConvertError(
    400,
    "Missing required `url` query parameter.",
    "missing_url"
  );
};

const parseFormat = (raw?: string | null): OutputFormat => {
  if (!raw || raw === "markdown") {
    return "markdown";
  }
  if (raw === "obsidian") {
    return "obsidian";
  }
  if (raw === "json") {
    return "json";
  }
  throw new ConvertError(
    400,
    "`format` must be `markdown`, `obsidian`, or `json`.",
    "invalid_format"
  );
};

const DEFAULT_THREAD = "full";

const canonicalThreadCacheValue = (raw?: string | null): string => {
  if (raw === "off") {
    return "off";
  }
  if (!raw || raw === "full" || raw === "conversation") {
    return DEFAULT_THREAD;
  }
  return raw;
};

interface ThreadSelection {
  limit: number;
  mode: "off" | "full";
}

const parseThread = (raw: string | null | undefined): ThreadSelection => {
  if (raw === "off") {
    return { limit: 1, mode: "off" };
  }

  if (!raw || raw === "full" || raw === "conversation") {
    return { limit: 100, mode: "full" };
  }

  const parsed = Math.trunc(Number(raw));
  if (Number.isFinite(parsed) && parsed >= 2 && parsed <= 100) {
    return { limit: parsed, mode: "full" };
  }

  throw new ConvertError(
    400,
    "`thread` must be `off`, `full`, `conversation`, or a number from 2 to 100.",
    "invalid_thread"
  );
};

const parseUserinfo = (raw?: string | null): UserinfoLevel => {
  if (!raw || raw === "off") {
    return "off";
  }
  if (raw === "author") {
    return "author";
  }
  if (raw === "all") {
    return "all";
  }
  throw new ConvertError(
    400,
    "`userinfo` must be `off`, `author`, or `all`.",
    "invalid_userinfo"
  );
};

type FlagValue = string | boolean | null | undefined;

const parseBoolean = (raw: FlagValue): boolean => {
  if (raw === true) {
    return true;
  }
  if (raw === false || raw === null || raw === undefined) {
    return false;
  }
  return raw === "1" || raw === "true" || raw === "yes";
};

const parseContext = (raw?: string | null): ContextMode => {
  if (!raw || raw === "full") {
    return "full";
  }
  if (raw === "thread") {
    return "thread";
  }
  throw new ConvertError(
    400,
    "`context` must be `full` or `thread`.",
    "invalid_context"
  );
};

const parseReplies = (raw?: string | null): RepliesMode => {
  if (!raw || raw === "top") {
    return "top";
  }
  if (raw === "recent" || raw === "off") {
    return raw;
  }
  throw new ConvertError(
    400,
    "`replies` must be `top`, `recent`, or `off`.",
    "invalid_replies"
  );
};

const withSourceUrls = (tweet: FxTweet, fallback?: string): FxTweet => {
  const handle = tweet.author?.screen_name;
  const url =
    tweet.url ??
    (handle && tweet.id
      ? `https://x.com/${handle}/status/${tweet.id}`
      : fallback);
  return {
    ...tweet,
    quote: tweet.quote ? withSourceUrls(tweet.quote) : undefined,
    url,
  };
};

const limitPostsByRole = (
  posts: FxTweet[],
  requestedId: string,
  limit: number
): FxTweet[] => {
  if (posts.length <= limit) {
    return posts;
  }
  const priorityFor = (post: FxTweet): number => {
    if (post.id === requestedId) {
      return 0;
    }
    return post.context === "parent" || post.context === "thread" ? 1 : 2;
  };
  const focalIndex = posts.findIndex((post) => post.id === requestedId);
  const candidates = posts.map((post, index) => ({
    index,
    post,
    priority: priorityFor(post),
  }));
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Closest parent first; continuations and ranked replies retain provider order.
    if (a.post.context === "parent" && b.post.context === "parent") {
      return Math.abs(focalIndex - a.index) - Math.abs(focalIndex - b.index);
    }
    return a.index - b.index;
  });
  const selected = new Set(
    candidates.slice(0, limit).map(({ index }) => index)
  );
  return posts.filter((_post, index) => selected.has(index));
};

type ConvertPayload = Omit<ConvertSuccess, "cache">;

const convertTweetUncached = async (
  format: OutputFormat,
  thread: ThreadSelection,
  userinfo: UserinfoLevel,
  canonicalUrl: string,
  handle: string,
  id: string,
  compact: boolean,
  context: ContextMode,
  replies: RepliesMode
): Promise<ConvertPayload> => {
  const warnings: string[] = [];

  const { tweets, source } = await fetchPosts(
    handle,
    id,
    thread.mode,
    context,
    replies
  );

  let posts = tweets;
  if (thread.mode === "full" && posts.length > thread.limit) {
    posts = limitPostsByRole(posts, id, thread.limit);
    warnings.push(`Thread truncated to ${thread.limit} posts.`);
  }
  posts = posts.map((post) =>
    withSourceUrls(
      post,
      post.id === id || posts.length === 1 ? canonicalUrl : undefined
    )
  );

  if (source !== "fxtwitter") {
    warnings.push(
      `Fetched via ${source} fallback — threads, full articles, and quotes may be limited.`
    );
  }

  const body = renderThreadMarkdown(posts, {
    canonicalUrl,
    compact: compact && format !== "obsidian",
    format: format === "json" ? "markdown" : format,
    userinfo,
  });

  return {
    body,
    canonicalUrl,
    compact: compact && format !== "obsidian",
    format,
    postCount: posts.length,
    posts,
    source,
    warnings,
  };
};

export const convertTweet = async (
  input: ConvertInput,
  config: RuntimeConfig = memoryConfig()
): Promise<ConvertSuccess> => {
  const format = parseFormat(input.format);
  const thread = parseThread(input.thread);
  const userinfo = parseUserinfo(input.userinfo);
  const nocache = parseBoolean(input.nocache);
  const compact = !parseBoolean(input.full);
  const context = parseContext(input.context);
  const replies = parseReplies(input.replies);
  const { canonicalUrl, handle, id } = resolveTarget(input);

  const cacheKey = buildCacheKey({
    compact: compact ? "1" : "0",
    context,
    format,
    handle: handle.toLowerCase(),
    id,
    replies,
    thread: canonicalThreadCacheValue(input.thread),
    userinfo: input.userinfo ?? "off",
    v: 5,
  });

  const { value, status } = await withCache(
    cacheKey,
    nocache,
    () =>
      convertTweetUncached(
        format,
        thread,
        userinfo,
        canonicalUrl,
        handle,
        id,
        compact,
        context,
        replies
      ),
    config
  );

  return { ...value, cache: status };
};

export const acceptPrefersHtml = (accept: string): boolean => {
  if (accept.includes("application/json") || accept.includes("text/markdown")) {
    return false;
  }
  return accept.includes("text/html");
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const htmlMarkdownPage = (
  markdown: string,
  canonicalUrl: string
): string =>
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(canonicalUrl)} · x-lookup</title>
  <style>
    body { margin: 0; background: #08090a; color: #d0d6e0; font-family: "IBM Plex Mono", ui-monospace, monospace; }
    pre { margin: 0; padding: 1.5rem; white-space: pre-wrap; word-break: break-word; line-height: 1.65; font-size: 13px; }
  </style>
</head>
<body><pre>${escapeHtml(markdown)}</pre></body>
</html>`;

export const markdownResponse = (
  result: ConvertSuccess,
  asJson = false,
  asHtml = false
): HttpPayload => {
  const sharedHeaders: HeaderMap = {
    Vary: "Accept, User-Agent",
    "X-Cache": result.cache.toUpperCase(),
    "X-Converter": "x-lookup",
    "X-Post-Count": String(result.postCount),
    "X-Source": result.source,
    "X-Warnings": String(result.warnings.length),
  };

  if (result.cache !== "bypass") {
    sharedHeaders["Cache-Control"] = cacheControlHeader();
  }

  if (asJson) {
    return {
      body: JSON.stringify({
        cache: result.cache,
        compact: result.compact,
        format: result.format,
        markdown: result.body,
        postCount: result.postCount,
        posts: result.posts,
        source: result.source,
        url: result.canonicalUrl,
        warnings: result.warnings,
      }),
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...sharedHeaders,
      },
      status: 200,
    };
  }

  if (asHtml) {
    return {
      body: htmlMarkdownPage(result.body, result.canonicalUrl),
      headers: { "Content-Type": "text/html; charset=utf-8", ...sharedHeaders },
      status: 200,
    };
  }

  return {
    body: result.body,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ...sharedHeaders,
    },
    status: 200,
  };
};
