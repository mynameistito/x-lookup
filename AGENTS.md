# Agent notes

## Commands

- Install: `bun install`
- Test: `bun run test` (vitest, files in `src/__tests__/*.test.ts`)
- Typecheck: `bun run typecheck` (`tsc --noEmit`)
- Local dev: `bun run dev` (wrangler dev, no login required for local mode)
- Deploy: `bun run deploy` (requires Cloudflare auth; attaches custom domain `x.mynameistito.com`)

## Architecture

- Single Cloudflare Worker, API-only. No frontend build step, no static assets.
- Entry: `src/worker.ts` (thin) → `src/router.ts` (`handleRequest(request, env)`).
- Domain logic in `src/lib/` is runtime-agnostic: Web-standard `Request`/`Response`/`fetch` only. Never import `node:*` there.
- Upstreams (free, no keys): FxTwitter `https://api.fxtwitter.com` and Twitter syndication `https://cdn.syndication.twimg.com`. Do not add paid providers (Context.dev, Firecrawl) or their secrets.
- Cache seam in `src/lib/cache.ts`: `CacheStore` interface with `MemoryStore` (L1) and `CacheApiStore` (Cloudflare `caches.default`, L2). `withCache(key, nocache, fn, config)` composes L1→L2 and returns `{ value, status }` driving the `X-Cache` header. TTL from `CACHE_TTL_SECONDS` var (default 3600); `nocache=true` bypasses entirely.
- Search gating rule: when FxTwitter refuses a search (upstream NOT_FOUND), respond 502 `{ error, code: 'search_unavailable' }` — never a fake 404 "post not found".
- Host allowlist for `requestOrigin` lives in `src/lib/http.ts`; known hosts are `x.mynameistito.com` plus localhost entries for `wrangler dev`.
- Error contract: every failure is JSON `{ "error": string, "code": string }` with a truthful status (400 bad input, 404 genuinely missing, 502 upstream refusal/failure).

## Conventions

- Bun only. TypeScript strict; no default exports unless required by the Workers runtime.
- Tests colocated under `src/__tests__/` with `.test.ts` suffix.
