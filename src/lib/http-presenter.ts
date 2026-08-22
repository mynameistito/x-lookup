import { renderBrowseMarkdown } from "@/lib/browse-renderer.ts";
import type { BrowseRequest, BrowseResult } from "@/lib/browse.ts";
import { cacheControlHeader } from "@/lib/cache.ts";
import type { ConvertSuccess } from "@/lib/converter.ts";
import { buildEmbedHtml, oembedPayload, pickFocalTweet } from "@/lib/embed.ts";
import type { EmbedOptions, OEmbedQuery } from "@/lib/embed.ts";
import type { HeaderMap, HttpPayload } from "@/lib/http.ts";
import { renderThreadMarkdown } from "@/lib/markdown.ts";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Build the browse endpoint payload from application data. */
export const browseResponse = (
  request: BrowseRequest,
  result: BrowseResult,
  asJson: boolean
): HttpPayload => {
  const markdown = renderBrowseMarkdown(request, result);
  const headers: HeaderMap = {
    "Content-Type": asJson ? JSON_CONTENT_TYPE : "text/markdown; charset=utf-8",
    Vary: "Accept",
    "X-Browse-Resource": result.resource,
    "X-Cache": result.cache.toUpperCase(),
    "X-Result-Count": String(result.posts?.length ?? result.users?.length ?? 0),
    "X-Source": "fxtwitter",
  };
  if (result.cache !== "bypass") {
    headers["Cache-Control"] = cacheControlHeader();
  }
  return {
    body: asJson ? JSON.stringify({ ...result, markdown }) : markdown,
    headers,
    status: 200,
  };
};

const htmlMarkdownPage = (markdown: string, canonicalUrl: string): string =>
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

/** Build a conversion payload after HTTP content negotiation is complete. */
export const markdownResponse = (
  result: ConvertSuccess,
  asJson = false,
  asHtml = false
): HttpPayload => {
  const markdown = renderThreadMarkdown(result.posts, {
    canonicalUrl: result.canonicalUrl,
    compact: result.compact && result.format !== "obsidian",
    format: result.format === "json" ? "markdown" : result.format,
    userinfo: result.userinfo,
  });
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
        markdown,
        postCount: result.postCount,
        posts: result.posts,
        source: result.source,
        url: result.canonicalUrl,
        warnings: result.warnings,
      }),
      headers: { "Content-Type": JSON_CONTENT_TYPE, ...sharedHeaders },
      status: 200,
    };
  }
  if (asHtml) {
    return {
      body: htmlMarkdownPage(markdown, result.canonicalUrl),
      headers: { "Content-Type": "text/html; charset=utf-8", ...sharedHeaders },
      status: 200,
    };
  }
  return {
    body: markdown,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ...sharedHeaders,
    },
    status: 200,
  };
};

/** Build the preview-bot payload from conversion application data. */
export const embedResponse = (
  result: ConvertSuccess,
  options: EmbedOptions
): HttpPayload => {
  const match = /\/status\/(?<id>\d+)/u.exec(result.canonicalUrl);
  const tweet = pickFocalTweet(result.posts, match?.groups?.id);
  if (!tweet) {
    return {
      body: JSON.stringify({
        code: "not_found",
        error: "Post not found or unavailable.",
      }),
      headers: { "Content-Type": JSON_CONTENT_TYPE },
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

/** Build the oEmbed JSON response payload. */
export const oembedResponse = (
  query: OEmbedQuery,
  origin: string
): HttpPayload => ({
  body: JSON.stringify(oembedPayload(query, origin)),
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
    "Content-Type": JSON_CONTENT_TYPE,
  },
  status: 200,
});
