# Plan 005: Bound anonymous upstream work

> **Executor instructions**: Follow this plan step by step. Touch only the listed files. Do not update `plans/README.md`; the reviewer maintains that index.
>
> **Drift check**: `git diff --stat fa6aeba..HEAD -- src/worker.ts src/http/router.ts src/application/browse.ts src/application/conversion.ts src/infrastructure src/http/payloads.ts __tests__`

## Status

- **Priority**: P1
- **Effort**: M/L
- **Risk**: MED
- **Depends on**: plans/004-health-semantics.md
- **Category**: security
- **Planned at**: commit `fa6aeba`, 2026-08-30

## Why this matters

The service is intentionally public and unauthenticated. Callers can bypass cache with `nocache=true`, walk up to ten pages, expand full threads, and request replies. The current code has no visible request budget or throttling boundary, so anonymous traffic can multiply upstream work even though the normal cached path is cheap.

## Current state

- `src/application/browse.ts:174-191` walks up to the requested page serially when no cursor is supplied; page parsing permits 1-10.
- `src/application/conversion.ts:247-251` honors uncached conversion requests.
- `src/worker.ts:77-88` exposes the MCP endpoint publicly with no identity requirement.
- `src/http/router.ts:20-35` permits all GET/HEAD/OPTIONS requests before application routing.
- Cache behavior is centralized in `src/infrastructure/cache/service.ts`; preserve the existing cache service and typed failure model.

## Commands

| Purpose | Command | Expected |
| --- | --- | --- |
| Tests | `bun run test -- __tests__/router.test.ts __tests__/browse.test.ts __tests__/converter.test.ts __tests__/cache.test.ts __tests__/mcp-server.test.ts` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Check | `bun run check` | no warnings/errors |
| Stack | `bun run alchemy:check` | all stack tests pass |

## Scope

**In scope**: a small request/upstream-work budget boundary, HTTP and MCP integration, typed `429` mapping if required, and tests.

**Out of scope**: authentication, paid rate-limit services, provider replacement, changing normal page/thread defaults, or storing user identity.

## Steps

### Step 1: Define the budget policy

Choose explicit limits for anonymous requests: maximum upstream calls per request, maximum page walking, maximum thread/reply expansion, and whether `nocache` is allowed. Prefer deterministic request-local accounting over global mutable counters. If a global per-client limiter is required, use a Cloudflare-native binding/configuration already supported by the deployment rather than inventing a new persistence layer.

**Verify**: add unit tests for budget acceptance/refusal; `bun run typecheck` -> exit 0.

### Step 2: Integrate at the application boundary

Enforce the budget before provider calls. Preserve cursor-based requests as the efficient path. Return a typed operational failure that maps to HTTP `429` and an MCP tool error with a stable code. Include `Retry-After` only when the limiter can calculate a truthful value.

**Verify**: focused router/application/MCP tests pass and assert no provider call occurs after refusal.

### Step 3: Add request-level observability

Expose safe headers or response metadata for work performed, such as an upstream-call count or budget status. Do not log or return request headers, credentials, or sensitive client data. Keep existing `X-Cache`, source, warning, and result headers compatible.

**Verify**: `bun run test -- __tests__/router.test.ts __tests__/mcp-server.test.ts` -> all pass.

### Step 4: Validate deployment behavior

Run the Alchemy stack test and verify local Worker behavior for HTTP and MCP paths. Confirm the policy applies consistently to both protocols and does not affect static metadata routes.

**Verify**: `bun run alchemy:check` -> all tests pass.

## Done criteria

- [ ] Anonymous upstream work has explicit, tested bounds.
- [ ] HTTP and MCP share the same policy and stable error code.
- [ ] Cache-hit/static requests remain cheap and unaffected.
- [ ] No secrets or raw client identifiers enter logs/responses.
- [ ] Full test, typecheck, check, and Alchemy validation pass.

## STOP conditions

- A correct limiter requires a new paid service or secret.
- The only available global state would be unsafe isolate-local accounting presented as a global guarantee.
- Existing clients depend on unlimited `nocache` or page walking and no compatibility mode can be stated clearly.

## Maintenance notes

Review every new provider call against the budget. If a future provider fallback adds calls, update the accounting and tests before merging it.
