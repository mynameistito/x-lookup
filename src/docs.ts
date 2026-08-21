export const ROOT_MARKDOWN = `# x-lookup

Read-only, no-auth browser for public X/Twitter content, built for AI agents.
Markdown by default, JSON on request, Open Graph HTML for preview bots.

## Endpoints

- \`GET /api/convert?url=<x-status-url>\` — statuses and threads (\`handle=\` + \`id=\` also works)
- \`GET /:handle/status/:id\` — same, via URL rewrite
- \`GET /search?q=…\` — search posts
- \`GET /:handle\` — profile + latest posts
- \`GET /:handle/followers\` · \`GET /:handle/following\`
- \`GET /api/browse?resource=profile|search|followers|following&…\`
- \`GET /oembed?url=…\` — oEmbed JSON
- \`GET /docs\` — full usage documentation

Full documentation: \`/docs\`.
`

export const DOCS_MARKDOWN = `# x-lookup API

Read-only, no-auth browser for public X/Twitter content, purpose-built for AI
agents. Responses are compact Markdown by default; request JSON with
\`format=json\` or \`Accept: application/json\`. Preview bots (Discord, Telegram,
Slack, …) receive Open Graph HTML when no explicit format is requested.
Browsers sending \`Accept: text/html\` get a readable page of the Markdown.

Every response carries CORS \`*\`. \`OPTIONS\` returns 204, \`HEAD\` is supported,
other methods return 405. Errors are always JSON:

\`\`\`json
{ "error": "string", "code": "string" }
\`\`\`

Statuses are truthful: 400 bad input, 404 genuinely missing content, 502
upstream refusal or failure. Search refusals from upstream surface as 502
\`search_unavailable\` — never a fake "post not found".

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
\`context\` fields.

Example:

\`\`\`bash
curl -sS -H 'Accept: text/markdown' \\
  'https://x.mynameistito.com/handle/status/1234567890?full=true'
\`\`\`

JSON output contains the rendered \`markdown\`, structured \`posts\`, \`warnings\`,
\`source\` provider, and \`cache\` status.

## Profiles, search, and social graphs

\`\`\`
GET /handle                          profile + latest original posts
GET /handle/followers                follower users
GET /handle/following                following users
GET /search?q=from:handle+topic      post search
GET /api/browse?resource=…           all of the above programmatically
\`\`\`

Shared parameters: \`limit\` (1–50, default 20), \`page\` (1–10),
\`cursor\` (opaque continuation), \`feed\` (latest | top | media, search only),
\`full\`, \`format\` (markdown | json), \`nocache\`.

Prefer the opaque cursor from the Markdown \`Continue →\` link or JSON
\`nextCursor\` over page walking.

Example:

\`\`\`bash
curl -sS -G 'https://x.mynameistito.com/search' \\
  --data-urlencode 'q=from:handle release' --data-urlencode 'feed=latest'
\`\`\`

## oEmbed

\`\`\`
GET /oembed?url=https://x.com/handle/status/1234567890
\`\`\`

Returns oEmbed JSON discovery payloads; optional \`text\`, \`author\`,
\`status\`, \`provider\` overrides mirror what the embed HTML advertises.

## Caching

Responses are cached in two tiers (isolate memory + Cloudflare edge cache) for
\`CACHE_TTL_SECONDS\` (default 3600). Repeat requests return \`X-Cache: HIT\`;
\`nocache=true\` returns \`X-Cache: BYPASS\`.

## Response headers

- \`X-Source\` — fetch provider (fxtwitter, syndication)
- \`X-Cache\` — HIT | MISS | BYPASS
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
`
