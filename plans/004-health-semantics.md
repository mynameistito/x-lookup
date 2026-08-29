# Plan 004: Separate liveness from readiness health checks

> **Executor instructions**: Follow this plan step by step. Touch only the listed files. Do not update `plans/README.md`; the reviewer maintains that index.
>
> **Drift check**: `git diff --stat fa6aeba..HEAD -- src/http/routes/static.ts src/http/payloads.ts src/mcp/server.ts src/metadata/api-catalog.ts __tests__/router.test.ts __tests__/mcp-server.test.ts`

## Status
- **Priority**: P2
- **Effort**: S/M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fa6aeba`, 2026-08-30

## Why this matters

Both HTTP `/health` and MCP `get_health` always return `{status:"ok"}` without checking dependencies. That is useful as liveness, but misleading as readiness when upstream providers are failing. Make the semantics explicit without making health probes trigger expensive or unbounded upstream requests.

## Current state

- `src/http/payloads.ts:104-105` returns static health JSON.
- `src/http/routes/static.ts:58-60` serves that payload without application services.
- `src/mcp/server.ts:318-325` returns the same static status.
- `src/metadata/api-catalog.ts:370-385` documents `/health` as service health.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Tests | `bun run test -- __tests__/router.test.ts __tests__/mcp-server.test.ts` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Check | `bun run check` | no warnings/errors |

## Scope

**In scope**: health route/payload semantics, MCP health description/response, OpenAPI metadata, and tests.

**Out of scope**: provider retries, production monitoring configuration, database checks, or making health probes call a live status/search endpoint by default.

## Steps

### Step 1: Define liveness explicitly

Document `/health` and `get_health` as liveness checks. Add version/schema fields only if they are static and safe. Preserve the current successful response for compatibility unless tests and metadata are updated together.

**Verify**: existing router and MCP health tests pass.

### Step 2: Add bounded readiness only if a safe probe exists

Add `/health/ready` and an MCP readiness operation only if a provider/cache probe can be bounded, cached, and represented with truthful typed failures. A static readiness response is not acceptable. Prefer reporting dependency availability without exposing upstream error details.

**Verify**: add tests for healthy and unavailable dependency states; run the focused tests.

### Step 3: Align metadata and error semantics

Update OpenAPI/catalog metadata to distinguish liveness and readiness status codes. Readiness failure must not be translated into a fake content `404`; use an operational status such as `503` only if the existing boundary model supports it.

**Verify**: `bun run test -- __tests__/router.test.ts __tests__/mcp-server.test.ts` -> all pass.

## Done criteria

- [ ] `/health` has an explicit liveness meaning.
- [ ] Any readiness endpoint has bounded, tested dependency semantics.
- [ ] HTTP, MCP, and OpenAPI descriptions agree.
- [ ] Full tests, typecheck, and check pass.

## STOP conditions

- A readiness check would make network calls on every probe without a cache or timeout.
- The existing typed error model cannot represent readiness failure truthfully.
- Monitoring compatibility requires preserving a response field that conflicts with the new semantics.

## Maintenance notes

Keep liveness cheap and dependency-free. Readiness probes must not become an upstream traffic multiplier.
