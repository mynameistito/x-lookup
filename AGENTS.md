# Agent Guide

## Working Method

1. Read this file, inspect the existing implementation, and check `git diff` before editing.
2. Discover the relevant skills under `.agents/skills/*/SKILL.md` and read every skill that matches the task. Treat those skills as project guidance, not optional background reading.
3. For TypeScript work, use `.agents/skills/coding-standards/SKILL.md`. For Effect services, Layers, dependency composition, or service audits, also use `.agents/skills/effect-service-design/SKILL.md` and its relevant references.
4. For linting, formatting, or code-quality work, use `.agents/skills/ultracite/SKILL.md` and follow the repository scripts.
5. For Effect API questions, read the installed package guidance first: `node_modules/effect/AGENTS.md`, then the relevant examples under `node_modules/effect/ai-docs/`, and finally the matching source or declarations under `node_modules/effect/src/` or `node_modules/effect/dist/`. If this repository is invoked from a directory where the package resolves as `../node_modules/effect`, use that resolved path instead. Prefer this pinned local package over memory or unrelated external copies.
6. Implement the smallest cohesive change, add or update tests for behavior, and run the required checks before reporting completion.

Completion means the implementation, tests, documentation, and validation results agree with one another; report any check that could not run and why.

## Commands

- Install: `bun install --frozen-lockfile`
- Test: `bun run test`
- Typecheck: `bun run typecheck`
- Check: `bun run check`
- Auto-fix formatting/lint: `bun run fix`
- Validate Alchemy stack: `bun run alchemy:check`
- Local dev: `bun run dev`
- Plan production infrastructure: `bun run plan`
- Deploy production: `bun run deploy`
- Destroy production: `bun run destroy`

Use Bun only. The pinned package manager is Bun `1.4.0`; commands and scripts in `package.json` are the source of truth.

## Project Shape

- This is one API-only Cloudflare Worker. There is no frontend build or static asset pipeline.
- `alchemy.run.ts` and the resource declaration in `src/worker.ts` are the infrastructure source of truth. There is no `wrangler.jsonc` or Wrangler dependency.
- `src/worker.ts` is the composition root. It builds the Effect Layer graph once and closes over it per fetch event. `src/http/router.ts` is the HTTP boundary.
- Runtime-agnostic code is organized by responsibility: application services in `src/application/`, parsers and value objects in `src/domain/`, upstream ports/adapters in `src/providers/`, cache implementations in `src/infrastructure/`, response rendering in `src/presentation/`, and HTTP boundary code in `src/http/`. Keep `node:*` imports out of these modules.
- Tests belong in root `__tests__/` and use the `.test.ts` suffix. Test provider I/O through the `HttpClient.HttpClient` seam, not global `fetch` stubs.
- Use named exports everywhere except the default export required by `alchemy.run.ts`.

## Invariants

- Expected failures are typed values. Preserve the existing `Data.TaggedError` and `HttpMappedError` model; translate failures to HTTP only at the boundary.
- Every HTTP failure is JSON shaped as `{ "error": string, "code": string }` with a truthful status: 400 for bad input, 404 only for a genuinely missing resource, and 502 for upstream refusal or failure.
- If FxTwitter refuses a search with upstream `NOT_FOUND`, return 502 with code `search_unavailable`; never turn it into a fake post-not-found 404.
- Free upstreams are FxTwitter (`https://api.fxtwitter.com`) and Twitter syndication (`https://cdn.syndication.twimg.com`). Do not add paid providers or provider secrets.
- `Cache` in `src/infrastructure/cache/service.ts` composes ordered stores: isolate-shared `MemoryStore` L1 and Cloudflare Cache API L2. `CACHE_TTL_SECONDS` defaults to 3600; `nocache=true` bypasses caching.
- `requestOrigin` in `src/http/request.ts` enforces the host allowlist: production domain `x-lookup.mynameistito.com` and local development hosts.
- Only `prod` uses the physical Worker name `x-lookup` and the production custom domain. Other stages must remain isolated, including local and PR preview stages.

## Effect Rules

- Keep `effect`, `@effect/platform-bun`, and `@effect/platform-node` on the same pinned Effect 4 RC as Alchemy compatibility requires. Update them together with Alchemy when changing that pairing.
- Prefer `Effect.gen` for readable effect sequencing and named `Effect.fn("name")` for functions returning Effects.
- Use Effect `Schema` for parsing untrusted data and domain modeling. Use existing Effect services (`HttpClient`, `Clock`, `Random`, `Config`, and so on) before introducing an application service.
- Services own real authority or effectful variability. Keep request values, parsers, projections, and deterministic calculations as values or pure modules.
- Keep service contracts narrow and domain-shaped. Put application-owned ports beside the application operation that needs them; keep concrete provider and runtime types inside adapters or the composition root.
- Compose concrete Layers at the composition root. Do not make inner application code choose infrastructure implementations.
- Use honest test Layers and test through public service seams. Do not create production abstractions solely to enable mocking.

## Alchemy And Deployment

- Local Alchemy uses the `default` profile unless `ALCHEMY_PROFILE` is set. In PowerShell, set `$env:ALCHEMY_PROFILE = "your-profile"`; profiles live in `~/.alchemy/profiles.json`.
- `Cloudflare.state()` bootstraps the Alchemy state-store Worker on first deploy.
- Production adoption preserves the existing Wrangler-era Worker named `x-lookup`; do not casually destroy or recreate it.
- CI runs credential-free install, Ultracite, typecheck, tests, and `alchemy:check`. Deployment requires the exact SHA to have successful CI: production from `main`, isolated `pr-<number>` previews for same-repository pull requests, and no credentials or previews for forks.
- Never claim a live production deployment without a real successful Actions run proving it.
