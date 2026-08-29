# Plan 001: Make MCP responses natively structured

> **Executor instructions**: Follow this plan step by step. Run every verification command before moving on. If a STOP condition occurs, stop and report. Touch only the listed files. Do not update `plans/README.md`; the reviewer maintains that index.
>
> **Drift check**: `git diff --stat fa6aeba..HEAD -- src/mcp/server.ts __tests__/mcp-server.test.ts package.json`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `fa6aeba`, 2026-08-30

## Why this matters

MCP browse and conversion tools currently return JSON only as a string inside `content[0].text`. Clients must parse a second protocol layer, and tool discovery cannot expose response fields. Add MCP-native structured output while retaining readable text for clients that use it.

## Current state

- `src/mcp/server.ts:157-179` builds `errorResult` and `jsonResult`; success has only `content`.
- `src/mcp/server.ts:193-221` serializes browse and conversion responses through `JSON.stringify` and does not register output schemas.
- `__tests__/mcp-server.test.ts:216-337` tests tool calls through the Worker boundary and is the existing MCP seam.
- The repository uses Effect for application services and Zod only at the MCP transport boundary. Preserve typed failures and do not introduce `any`.

## Commands

| Purpose | Command | Expected |
| --- | --- | --- |
| Install | `bun install --frozen-lockfile` | exit 0 |
| Tests | `bun run test -- __tests__/mcp-server.test.ts` | all MCP tests pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint/format | `bun run check` | 0 warnings and 0 errors |

## Scope

**In scope**: `src/mcp/server.ts`, `__tests__/mcp-server.test.ts`, and only metadata/type files required to express output schemas.

**Out of scope**: HTTP route behavior, application services, provider adapters, MCP authentication, and removal of existing tool names.

## Steps

### Step 1: Define stable MCP output schemas and projections

Add explicit Zod output schemas for browse results, conversion results, oEmbed, and health. Match the actual JSON fields produced by `browseResponse` and `markdownResponse`; optional fields must remain optional. Keep provider payload fields permissive only where the existing response intentionally preserves upstream fields.

**Verify**: `bun run typecheck` -> exit 0.

### Step 2: Return structured content plus text

Change successful tool results to include the parsed object in the MCP SDK's structured-output field and retain the serialized object as text. Register each tool's output schema. Keep error results as `isError: true` with the existing `{ error, code }` text shape unless the SDK supports an error structured payload without changing client behavior.

**Verify**: `bun run test -- __tests__/mcp-server.test.ts` -> all tests pass.

### Step 3: Test protocol-visible structure

Extend boundary tests to inspect `tools/list` for output schemas and tool calls for structured content containing `markdown`, `posts`, `cache`, and `source` where applicable. Test at least one browse success, conversion success, validation failure, and typed provider failure.

**Verify**: `bun run test -- __tests__/mcp-server.test.ts` -> all MCP tests pass, including the new assertions.

## Done criteria

- [ ] Successful browse/conversion MCP calls expose structured content.
- [ ] Tool listing exposes output schemas.
- [ ] Existing tool names, error codes, and text content remain compatible.
- [ ] `bun run typecheck`, `bun run test`, and `bun run check` pass.
- [ ] Only in-scope files are modified.

## STOP conditions

- The installed MCP SDK does not support the expected output schema or structured content API; stop and report the exact declaration/API found.
- Existing MCP tests require a different response shape than this plan describes.
- A public HTTP response must change to implement the MCP output.

## Maintenance notes

Future MCP tools should reuse these output schemas instead of returning ad hoc JSON text. Review that structured content and text remain semantically identical.
