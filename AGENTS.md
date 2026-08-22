# Agent notes

## Commands

- Install: `bun install --frozen-lockfile` (Bun `1.4.0`)
- Test: `bun run test` (vitest, files in `__tests__/*.test.ts`)
- Typecheck: `bun run typecheck` (`tsc --noEmit`; includes `alchemy.run.ts`)
- Lint/format: `bun run check` / `bun run fix` (Ultracite)
- Local dev: `bun run dev` (`alchemy dev`, local workerd, stage `dev_<user>`)
- Plan: `bun run plan` (`alchemy plan --stage prod`; requires Cloudflare auth)
- Deploy: `bun run deploy` (`alchemy deploy --stage prod --yes --adopt`)
- Destroy: `bun run destroy` (`alchemy destroy --stage prod`; interactive confirm)
- Alchemy stack validation: `bun run alchemy:check` (credential-free; loads and constructs `alchemy.run.ts` under vitest)

## Architecture

- Single Cloudflare Worker, API-only. No frontend build step, no static assets.
- Infrastructure source of truth: `alchemy.run.ts` + the resource declaration in `src/worker.ts`. There is no `wrangler.jsonc` and no wrangler dependency.
- Runtime composition root: `src/worker.ts` builds the Effect Layer graph once (providers → PostLookup/Browse/Conversion) and closes over it per fetch event. HTTP boundary: `src/router.ts`.
- Domain logic in `src/lib/` is runtime-agnostic. Expected failures are typed values (`Data.TaggedError` implementing `HttpMappedError` in `src/lib/provider-errors.ts`); nothing throws for expected failures. Never import `node:*` in `src/lib/`.
- Stage identity (`resolveWorkerIdentity` in `src/worker.ts`): only stage `prod` pins the physical script name `x-lookup` and custom domain `x-lookup.mynameistito.com`. Every other stage (local dev, PR previews) derives an isolated identity, so previews can never touch production.
- Upstreams (free, no keys): FxTwitter `https://api.fxtwitter.com` and Twitter syndication `https://cdn.syndication.twimg.com`. Do not add paid providers (Context.dev, Firecrawl) or their secrets.
- Cache seam in `src/lib/cache.ts`: `Cache` Effect service over ordered `CacheStore`s — isolate-shared `MemoryStore` (L1) plus Cloudflare Cache API L2 (`layerWorker`). TTL from `CACHE_TTL_SECONDS` var (default 3600); `nocache=true` bypasses entirely.
- Search gating rule: when FxTwitter refuses a search (upstream NOT_FOUND), respond 502 `{ error, code: 'search_unavailable' }` — never a fake 404 "post not found".
- Host allowlist for `requestOrigin` lives in `src/lib/http.ts`; known hosts are `x-lookup.mynameistito.com` plus localhost entries for local dev.
- Error contract: every failure is JSON `{ "error": string, "code": string }` with a truthful status (400 bad input, 404 genuinely missing, 502 upstream refusal/failure).

## Conventions

- Bun only. TypeScript strict; no default exports unless required by the Alchemy CLI or Workers runtime.
- Tests live under root `__tests__/` with `.test.ts` suffix; provider I/O is tested through the `HttpClient.HttpClient` seam, never by stubbing global `fetch`.

## Deployment (Alchemy)

- Auth: local commands use Alchemy's `default` profile unless `ALCHEMY_PROFILE` is set; in PowerShell use `$env:ALCHEMY_PROFILE = "your-profile"` before `bun run ...`. Profiles live in `~/.alchemy/profiles.json`; CI uses `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repository secrets referenced by name only.
- State: `Cloudflare.state()` bootstraps a state-store Worker into the account on first deploy (`--yes` auto-confirms upgrades).
- Adoption: the first prod deploy runs with `--adopt` so the pre-Alchemy Wrangler-era Worker named `x-lookup` is adopted in place rather than recreated; afterwards Alchemy ownership tags make the flag a no-op. Never destroy/recreate that Worker casually.
- CI: `.github/workflows/ci.yml` runs credential-free checks (install frozen lockfile, Ultracite, typecheck, tests, `alchemy:check`). `.github/workflows/deploy.yml` deploys only from successful CI `workflow_run` events for the exact SHA: `prod` on `main` and isolated `pr-<number>` preview stacks for same-repository pull requests. Preview cleanup runs from the trusted default branch, requires the protected `preview-cleanup` environment, destroys before deleting deployment records, and refuses every stage other than `pr-<number>`. Fork pull requests never receive credentials or preview deployments.
- Do not claim a live production deploy unless a real Actions run proves it.
- Dependency pairing: Alchemy 2.x peer-requires Effect `>=4.0.0-beta.105`. Keep `effect`, `@effect/platform-bun`, and `@effect/platform-node` on the same Effect 4 RC that the alchemy repo pins, and bump them together with `alchemy`.
- The default export of `alchemy.run.ts` is required by the Alchemy CLI; everything else uses named exports.
