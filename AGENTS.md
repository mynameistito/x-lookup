# Agent notes

## Commands

- Install: `bun install`
- Test: `bun run test` (vitest, files in `src/__tests__/*.test.ts`)
- Typecheck: `bun run typecheck` (`tsc --noEmit`; includes `alchemy.run.ts`)
- Lint/format: `bun run check` / `bun run fix` (Ultracite)
- Local dev: `bun run dev` (wrangler dev, no login required for local mode)
- Deploy: `bun run deploy` (requires Cloudflare auth; attaches custom domain `x-lookup.mynameistito.com`)
- Alchemy stack validation: `bun run alchemy:check` (credential-free; loads and constructs `alchemy.run.ts` under vitest)

## Architecture

- Single Cloudflare Worker, API-only. No frontend build step, no static assets.
- Entry: `src/worker.ts` (thin) → `src/router.ts` (`handleRequest(request, env)`).
- Domain logic in `src/lib/` is runtime-agnostic: Web-standard `Request`/`Response`/`fetch` only. Never import `node:*` there.
- Upstreams (free, no keys): FxTwitter `https://api.fxtwitter.com` and Twitter syndication `https://cdn.syndication.twimg.com`. Do not add paid providers (Context.dev, Firecrawl) or their secrets.
- Cache seam in `src/lib/cache.ts`: `CacheStore` interface with `MemoryStore` (L1) and `CacheApiStore` (Cloudflare `caches.default`, L2, defined in `src/lib/cache-api-store.ts` and re-exported). `withCache(key, nocache, fn, config)` composes L1→L2 and returns `{ value, status }` driving the `X-Cache` header. TTL from `CACHE_TTL_SECONDS` var (default 3600); `nocache=true` bypasses entirely.
- Search gating rule: when FxTwitter refuses a search (upstream NOT_FOUND), respond 502 `{ error, code: 'search_unavailable' }` — never a fake 404 "post not found".
- Host allowlist for `requestOrigin` lives in `src/lib/http.ts`; known hosts are `x-lookup.mynameistito.com` plus localhost entries for `wrangler dev`.
- Error contract: every failure is JSON `{ "error": string, "code": string }` with a truthful status (400 bad input, 404 genuinely missing, 502 upstream refusal/failure).

## Conventions

- Bun only. TypeScript strict; no default exports unless required by the Workers runtime.
- Tests colocated under `src/__tests__/` with `.test.ts` suffix.

## Alchemy foundation (transitional)

- `alchemy.run.ts` models the production deployment with Alchemy v2 + Effect v4 RC: Worker logical id and physical name `x-lookup`, entrypoint `src/worker.ts`, compatibility date `2026-08-01`, observability enabled, `CACHE_TTL_SECONDS=3600`, custom domain `x-lookup.mynameistito.com`.
- It is NOT the active deployment path yet. `wrangler.jsonc` + `bun run deploy` remain authoritative until the deployment cutover issue lands. Do not run `alchemy deploy`/`plan` before then: the stack pins the physical script name `x-lookup` for prod parity, so per-stage isolation (staging/PR names) does not exist yet.
- Credential-free validation only: `bun run typecheck` covers the stack and `bun run alchemy:check` constructs it without contacting Cloudflare. `alchemy plan`/`deploy`/`dev` require Cloudflare credentials plus interactive consent — never wire them into PR CI.
- Dependency pairing: Alchemy 2.x peer-requires Effect `>=4.0.0-beta.105`. Keep `effect`, `@effect/platform-bun`, and `@effect/platform-node` on the same Effect 4 RC that the alchemy repo pins, and bump them together with `alchemy`.
- The default export of `alchemy.run.ts` is required by the Alchemy CLI; everything else uses named exports.
