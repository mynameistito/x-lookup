export const ROOT_MARKDOWN = `# x-lookup

Read-only, no-auth browser for public X/Twitter content, purpose-built for AI
agents. Statuses and threads, profiles, search, followers/following — served as
compact Markdown by default, structured JSON on request, Open Graph HTML for
chat-app preview bots, plus an oEmbed endpoint.

Made by **[mynameistito](https://github.com/mynameistito)**
· Source: [github.com/mynameistito/x-lookup](https://github.com/mynameistito/x-lookup)
· Hosted at [x-lookup.mynameistito.com](https://x-lookup.mynameistito.com)

Not affiliated with X Corp. No database, no login, no API keys — the only
upstreams are the free FxTwitter API and Twitter's syndication endpoint.

## Quick start

Swap \`x.com\` for this host on any public status URL:

\`\`\`
https://x.com/handle/status/1234567890
→ https://x-lookup.mynameistito.com/handle/status/1234567890
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

| Route | Purpose |
| --- | --- |
| \`GET /api/convert?url=<x-status-url>\` (or \`handle=\` + \`id=\`) | Convert a status/thread |
| \`GET /:handle/status/:id\` | Same, via URL rewrite |
| \`GET /api/browse?resource=profile\\|search\\|followers\\|following&…\` | Browse endpoint |
| \`GET /search?q=…\` · \`GET /:handle\` · \`GET /:handle/followers\` · \`GET /:handle/following\` | Shortcuts |
| \`GET /oembed?url=…\` | oEmbed JSON |
| \`GET /\` · \`GET /docs\` | This documentation |

## Content negotiation

- Default → compact Markdown (\`text/markdown\`)
- \`format=json\` or \`Accept: application/json\` → structured JSON
- \`format=obsidian\` → expanded Obsidian-flavored Markdown
- Preview-bot User-Agents (Discord, Telegram, Slack, …) → Open Graph HTML
- \`Accept: text/html\` from browsers → readable HTML page of the Markdown

Every response carries CORS \`*\`; \`OPTIONS\` returns 204, \`HEAD\` is supported,
other methods return 405.

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

Shared parameters: \`limit\` (1–50, default 20), \`page\` (1–10),
\`cursor\` (opaque continuation), \`feed\` (latest \\| top \\| media, search only),
\`full\`, \`format\` (markdown \\| json), \`nocache\`.

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
`
