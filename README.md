# x-lookup

Read-only, no-auth browser for public X/Twitter content, purpose-built for AI agents. Statuses and threads, profiles, search, followers/following — served as compact Markdown by default, structured JSON on request, Open Graph HTML for chat-app preview bots, plus an oEmbed endpoint.

Hosted at [https://x-lookup.mynameistito.com](https://x-lookup.mynameistito.com) as a single Cloudflare Worker. No database, no login, no API keys — the only upstreams are the free FxTwitter API and Twitter's syndication endpoint.

**Not affiliated with X Corp.**

## Quick start

Replace `x.com` with `x-lookup.mynameistito.com` on any public status URL:

```text
https://x.com/handle/status/1234567890
https://x-lookup.mynameistito.com/handle/status/1234567890
```

```bash
curl -sS -H "Accept: text/markdown" "https://x-lookup.mynameistito.com/handle/status/1234567890"

curl -sS -G "https://x-lookup.mynameistito.com/api/convert" --data-urlencode "url=https://x.com/handle/status/1234567890"
```

Browsers that request HTML get a readable page containing the Markdown. Discord, Telegram, Slack, and other preview bots receive Open Graph embed HTML.

## Routes

| Route | Purpose | Query parameters |
| --- | --- | --- |
| `GET /api/convert?url=<x-status-url>` (or `handle=` + `id=`) | Convert a status/thread | see [Post conversion parameters](#post-conversion-parameters) |
| `GET /:handle/status/:id` | Same, via URL rewrite | same as `/api/convert` |
| `GET /api/browse?resource=profile\|search\|followers\|following&…` | Browse endpoint | see [Browse parameters](#browse-parameters) |
| `GET /search?q=…` | Search posts | `q` (required), `feed`, `cursor`, `page`, `limit`, `full`, `format`, `nocache` |
| `GET /:handle` | Profile + latest original posts | `cursor`, `page`, `limit`, `full`, `format`, `nocache` |
| `GET /:handle/followers` | Follower users | `cursor`, `page`, `limit`, `full`, `format`, `nocache` |
| `GET /:handle/following` | Following users | `cursor`, `page`, `limit`, `full`, `format`, `nocache` |
| `GET /oembed?url=…` | oEmbed JSON | `url`; optional `text`, `author`, `status`, `provider` overrides |
| `GET /` (also `/docs`) | Full usage documentation (Markdown) | — |

All API responses send CORS `*`, support `OPTIONS` (204) and `HEAD`; other methods get 405. Errors are always `{ "error": string, "code": string }` with a truthful status: 400 bad input, 404 genuinely missing content, 502 upstream refusal or failure.

## Post conversion parameters

Both `GET /:handle/status/:id` and `GET /api/convert?url=…` support:

| Parameter | Default | Supported values |
| --- | --- | --- |
| `format` | `markdown` | `markdown`, `obsidian`, `json` |
| `full` | false | `true`, `1`, or `yes` enables expanded Markdown; Obsidian is always expanded |
| `thread` | `full` | `off`, `full`, `conversation`, or a limit from `2` to `100` |
| `context` | `full` | `full` includes parents, author thread, and selected replies; `thread` excludes unrelated replies |
| `replies` | `top` | `top`, `recent`, `off` |
| `userinfo` | `off` | `off`, `author`, `all` |
| `nocache` | false | `true`, `1`, or `yes` bypasses the cache |

Content negotiation: `format=json` or `Accept: application/json` → JSON; preview-bot User-Agents with no explicit format → OG HTML; `Accept: text/html` → HTML page; otherwise Markdown.

## Browse parameters

`/api/browse`, `/search`, `/:handle`, and follower lists accept:

| Parameter | Default | Supported values |
| --- | --- | --- |
| `q` | — | Search query; required on `/search` and `resource=search`. Supports X operators like `from:`, `since:` |
| `feed` | `latest` | `latest`, `top`, `media` — search only |
| `cursor` | — | Opaque continuation token from `Continue →` / `nextCursor` |
| `page` | 1 | `1`–`10`; walks pages when no `cursor` is given |
| `limit` | 20 | `1`–`50` results per response |
| `full` | false | `true`, `1`, or `yes` adds dates/metrics to posts and follower counts/bios to users |
| `format` | `markdown` | `markdown`, `json` |
| `nocache` | false | `true`, `1`, or `yes` bypasses the cache |

Prefer the opaque cursor from the Markdown `Continue →` link or JSON `nextCursor` over page walking.

## Meaningful response headers

`X-Source` (fetch provider), `X-Cache` (`HIT`|`MISS`|`BYPASS`), `X-Browse-Resource`, `X-Result-Count`, `X-Converter`, `X-Post-Count`, `X-Warnings`, `X-Embed`.

## Search availability note

FxTwitter refuses some datacenter egress IPs. When that happens, search returns **502** with code `search_unavailable` — never a fake "post not found". Status lookups fall back from FxTwitter to Twitter's syndication endpoint.

## Development

```bash
bun install
bun run dev        # alchemy dev — local workerd, isolated dev_<user> stage
bun run test       # vitest
bun run typecheck  # tsc --noEmit
bun run plan       # preview the production diff (alchemy plan --stage prod)
bun run deploy     # alchemy deploy --stage prod (attaches x-lookup.mynameistito.com)
bun run destroy    # tear down the prod stack (interactive confirm)
```

Infrastructure lives entirely in `alchemy.run.ts` and `src/worker.ts` — there is no `wrangler.jsonc`. Local commands authenticate through the `mynameistito` Alchemy profile; CI uses `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repository secrets. In `prod`, the Worker keeps its physical name `x-lookup` and custom domain `x-lookup.mynameistito.com`; every other stage (local dev, PR previews) derives an isolated identity. The only var is `CACHE_TTL_SECONDS` (default 3600). There are no secrets. Caching is two-tier: in-isolate memory L1 plus Cloudflare Cache API L2.

CI runs credential-free lint/typecheck/tests plus a stateless stack validation (`.github/workflows/ci.yml`). `.github/workflows/deploy.yml` re-validates and deploys `prod` on pushes to `main`, gives same-repo pull requests an isolated `pr-<number>` preview stack (torn down when the PR closes), and never exposes credentials to fork pull requests.

Preview deployments and cleanup require GitHub Environment approval, while production deployments proceed automatically after a push to `main`. In repository **Settings → Environments**, create `production` with no required reviewers, and `preview` plus `preview-cleanup` with trusted maintainers or admins as required reviewers; disable self-review if available. Preview and cleanup approvals pause the trusted base-branch workflow before the pull-request revision is checked out or secrets are available.

The bundled agent skill in `skills/browse-x/` wraps this API for CLI use; override its target with `X_API_BASE` when testing another deployment.
