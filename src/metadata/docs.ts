export const ROOT_MARKDOWN = `# x-lookup

Read-only, no-auth browser for public X/Twitter content, purpose-built for AI
agents. Statuses and threads, profiles, search, followers/following — served as
compact Markdown by default, structured JSON on request.

Made by **[mynameistito](https://github.com/mynameistito)**
· Source: [github.com/mynameistito/x-lookup](https://github.com/mynameistito/x-lookup)
· Hosted at [x-lookup.mynameistito.com](https://x-lookup.mynameistito.com)

Not affiliated with X Corp. No database, no login, no API keys — the only
upstreams are the free FxTwitter API and Twitter's syndication endpoint.

## Quick start

Swap \`x.com\` for this host on any public status URL:

\`\`\`
https://x.com/handle/status/1234567890 → https://x-lookup.mynameistito.com/handle/status/1234567890
\`\`\`

\`\`\`bash
# A post as Markdown (default)
curl -sS 'https://x-lookup.mynameistito.com/handle/status/1234567890'

# Same post as structured JSON
curl -sS -H 'Accept: application/json' 'https://x-lookup.mynameistito.com/handle/status/1234567890'

# Full thread with expanded metadata
curl -sS 'https://x-lookup.mynameistito.com/api/convert?url=https://x.com/handle/status/1234567890&thread=full&full=true'

# Search posts
curl -sS -G 'https://x-lookup.mynameistito.com/search' --data-urlencode 'q=from:handle topic' --data-urlencode 'feed=latest'

# Profile + latest posts
curl -sS 'https://x-lookup.mynameistito.com/handle'
\`\`\`

## Endpoints

| Route | Purpose | Parameters |
| --- | --- | --- |
| \`GET /api/convert?url=<x-status-url>\` (or \`handle=\` + \`id=\`) | Convert a status/thread | see [Statuses and threads](#statuses-and-threads) |
| \`GET /:handle/status/:id\` | Same, via URL rewrite | same as \`/api/convert\` |
| \`GET /api/browse?resource=profile\\|search\\|followers\\|following&…\` | Browse endpoint | see [Profiles, search, and social graphs](#profiles-search-and-social-graphs) |
| \`GET /search?q=…\` | Post search | \`q\` (required), \`feed\`, \`cursor\`, \`page\`, \`limit\`, \`full\`, \`format\`, \`nocache\` |
| \`GET /:handle\` | Profile + latest original posts | \`cursor\`, \`page\`, \`limit\`, \`full\`, \`format\`, \`nocache\` |
| \`GET /:handle/followers\` | Follower users | \`cursor\`, \`page\`, \`limit\`, \`full\`, \`format\`, \`nocache\` |
| \`GET /:handle/following\` | Following users | \`cursor\`, \`page\`, \`limit\`, \`full\`, \`format\`, \`nocache\` |
| \`GET /oembed?url=…\` | oEmbed JSON | \`url\`; optional \`text\`, \`author\`, \`status\`, \`provider\` overrides |
| \`GET /og.png\` | 1200×630 Open Graph / Twitter share image | — |
| \`GET /\` · \`GET /docs\` | This documentation | — |

## Content negotiation

- Default → compact Markdown (\`text/markdown\`)
- \`format=json\` or \`Accept: application/json\` → structured JSON
- \`format=obsidian\` → expanded Obsidian-flavored Markdown
- Preview-bot User-Agents (Discord, Telegram, Slack, …) → Open Graph HTML
- \`Accept: text/html\` from browsers → readable HTML page of the Markdown

Every response carries CORS \`*\`; \`OPTIONS\` returns 204, \`HEAD\` is supported,
other methods return 405.

## MCP server

The same public, read-only capabilities are available through the stateless MCP
endpoint:


\`https://x-lookup.mynameistito.com/mcp\`

The server exposes \`browse_x\`, \`convert_status\`, \`search_posts\`,
\`get_profile\`, \`list_followers\`, \`list_following\`, \`get_oembed\`, and
\`get_health\`. Browse and conversion tools return structured JSON with the
same Markdown, posts, warnings, provider, and cache data as the HTTP API.
MCP requests are stateless and do not require authentication.

## Statuses and threads

\`\`\`
GET /api/convert?url=https://x.com/handle/status/1234567890
GET /handle/status/1234567890
\`\`\`

| Parameter | Default | Values |
| --- | --- | --- |
| format | markdown | markdown, obsidian, json |
| full | false | true expands metadata (Obsidian is always expanded) |
| thread | full | off, full, conversation, or 2–100 |
| context | full | full (parents + thread + replies), thread (author chain) |
| replies | top | top, recent, off |
| userinfo | off | off, author, all |
| nocache | false | true bypasses the cache |

The default conversation includes parent context, the author's thread, and top
replies, labeled as parent / post / thread / reply in headings and JSON
\`context\` fields. JSON output contains the rendered \`markdown\`, structured
\`posts\`, \`warnings\`, \`source\` provider, and \`cache\` status.

Example:

\`\`\`bash
curl -sS -H 'Accept: text/markdown' 'https://x-lookup.mynameistito.com/handle/status/1234567890?full=true'
\`\`\`

## Profiles, search, and social graphs

\`\`\`
GET /handle                          profile + latest original posts
GET /handle/followers                follower users
GET /handle/following                following users
GET /search?q=from:handle+topic      post search
GET /api/browse?resource=…           all of the above programmatically
\`\`\`

Shared parameters:

| Parameter | Default | Values |
| --- | --- | --- |
| q | — | Search query; required on \`/search\` and \`resource=search\`. Supports X operators like \`from:\`, \`since:\` |
| feed | latest | latest \\| top \\| media (search only) |
| cursor | — | Opaque continuation token from \`Continue →\` / JSON \`nextCursor\` |
| page | 1 | 1–10; walks pages when no cursor is given |
| limit | 20 | 1–50 results per response |
| full | false | true adds dates/metrics to posts and follower counts/bios to users |
| format | markdown | markdown \\| json |
| nocache | false | true bypasses the cache |

Prefer the opaque cursor from the Markdown \`Continue →\` link or JSON
\`nextCursor\` over page walking.

Example:

\`\`\`bash
curl -sS -G 'https://x-lookup.mynameistito.com/search' --data-urlencode 'q=from:handle release' --data-urlencode 'feed=latest'
\`\`\`

## oEmbed

\`\`\`
GET /oembed?url=https://x.com/handle/status/1234567890
\`\`\`

Returns oEmbed JSON discovery payloads; optional \`text\`, \`author\`,
\`status\`, \`provider\` overrides mirror what the embed HTML advertises.

## Errors

Errors are always JSON \`{ "error": string, "code": string }\` with truthful
statuses: 400 bad input, 404 genuinely missing content, 502 upstream refusal or
failure. Search refusals surface as 502 \`search_unavailable\` — never a fake
"post not found".

## Caching and response headers

Responses are cached in two tiers (isolate memory + Cloudflare edge cache) for
\`CACHE_TTL_SECONDS\` (default 3600). Repeat requests return \`X-Cache: HIT\`;
\`nocache=true\` returns \`X-Cache: BYPASS\`.

- \`X-Source\` — fetch provider (fxtwitter, syndication)
- \`X-Cache\` — HIT \\| MISS \\| BYPASS
- \`X-Browse-Resource\` — browse resource served
- \`X-Result-Count\` — number of posts/users in a browse response
- \`X-Converter\` — converter identifier
- \`X-Post-Count\` — number of posts in a conversion
- \`X-Warnings\` — warning count (see JSON warnings array)

## Sources and limits

Only public content is available. Upstreams are the free FxTwitter API and
Twitter's syndication endpoint; no keys, no paid services. Private, deleted,
or gated content cannot be read. Fallback sources may omit conversation posts,
articles, quotes, or media — check JSON \`warnings\` and \`source\` rather than
assuming missing content.

---

Made by **[mynameistito](https://github.com/mynameistito)**
· Source: [github.com/mynameistito/x-lookup](https://github.com/mynameistito/x-lookup)
· Hosted at [x-lookup.mynameistito.com](https://x-lookup.mynameistito.com)
· Not affiliated with X Corp.
`;

const ROOT_DESCRIPTION =
  "Read-only, no-auth browser for public X/Twitter content, purpose-built for AI agents. Statuses and threads, profiles, search, followers/following — served as compact Markdown by default, structured JSON on request.";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const rootHtml = (canonicalUrl: string): string => {
  const title = "x-lookup";
  const description = escapeHtml(ROOT_DESCRIPTION);
  const imageUrl = escapeHtml(new URL("/og.png", canonicalUrl).toString());
  const url = escapeHtml(canonicalUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="${title}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${imageUrl}">
  <style>
    body { margin: 0; background: #08090a; color: #d0d6e0; font-family: "IBM Plex Mono", ui-monospace, monospace; }
    pre { margin: 0; padding: 1.5rem; white-space: pre-wrap; word-break: break-word; line-height: 1.65; font-size: 13px; }
  </style>
</head>
<body><pre>${escapeHtml(ROOT_MARKDOWN)}</pre></body>
</html>`;
};
