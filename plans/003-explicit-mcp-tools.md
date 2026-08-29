# Plan 003: Add explicit MCP content tools and documentation resources

> **Executor instructions**: Follow this plan step by step. Touch only the listed files. Preserve all existing MCP aliases. Do not update `plans/README.md`; the reviewer maintains that index.
>
> **Drift check**: `git diff --stat fa6aeba..HEAD -- src/mcp/server.ts src/metadata/api-catalog.ts src/metadata/docs.ts __tests__/mcp-server.test.ts`

## Status
- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-structured-mcp-output.md, plans/002-canonical-api-contracts.md
- **Category**: direction
- **Planned at**: commit `fa6aeba`, 2026-08-30

## Why this matters

`browse_x` is a union of profile, search, followers, and following operations. Agents must understand unrelated inputs and output variants before selecting it. Add explicit tools while retaining aliases, and expose existing documentation/OpenAPI material as MCP resources if the SDK supports resources.

## Current state

- `src/mcp/server.ts:267-305` registers `browse_x`, `search_posts`, `get_profile`, `list_followers`, and `list_following`; the explicit aliases already exist for browse operations.
- `src/mcp/server.ts:257-265` calls the broad `convert_status` operation.
- `src/metadata/docs.ts`, `src/metadata/api-catalog.ts`, and `/openapi.json` already provide agent-facing documentation over HTTP.
- `__tests__/mcp-server.test.ts:88-116` verifies current tool discovery.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Tests | `bun run test -- __tests__/mcp-server.test.ts` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Check | `bun run check` | no warnings/errors |

## Scope

**In scope**: `src/mcp/server.ts`, MCP tests, and MCP-facing metadata/resource registration.

**Out of scope**: deleting `browse_x` or `convert_status`, adding authentication, downloading media, changing provider models, or changing HTTP routes.

## Steps

### Step 1: Add a simple `get_status` tool alias

Register `get_status` with a focused description and the same input/output semantics as `convert_status`, defaulting to a single-status-oriented configuration only if that default can be represented without changing `convert_status`. If defaults would diverge ambiguously, keep identical defaults and document the distinction in the description.

**Verify**: `bun run test -- __tests__/mcp-server.test.ts` -> discovery and call tests pass.

### Step 2: Add a focused conversation tool only if its contract is unambiguous

Prefer `get_conversation_context` only when it reduces options and has a clear mapping to `thread`, `context`, and `replies`. Do not add a tool that merely renames the existing operation. Reuse Plan 002 contracts and Plan 001 output schemas.

**Verify**: `bun run typecheck` -> exit 0; MCP tests pass.

### Step 3: Expose documentation as MCP resources when supported

Register read-only resources for the human docs and OpenAPI document using the existing metadata functions. If the installed MCP SDK lacks resource support or requires state/session behavior inconsistent with the stateless endpoint, stop this step and report it rather than introducing a new protocol mode.

**Verify**: `bun run test -- __tests__/mcp-server.test.ts` -> resource listing/read tests pass, or the documented SDK limitation is reported.

## Done criteria

- [ ] Explicit status/conversation discovery improves tool selection.
- [ ] Existing aliases remain available and behavior-compatible.
- [ ] Structured MCP outputs from Plan 001 are reused.
- [ ] Resource support is added only if compatible with stateless operation.
- [ ] Full tests, typecheck, and check pass.

## STOP conditions

- A new tool requires changing application semantics rather than composing an existing operation.
- The SDK resource API requires persistent sessions or Durable Objects.
- Existing clients would lose a registered tool or output field.

## Maintenance notes

New tools should be task-oriented, narrow, and backed by an existing application operation. Avoid adding a tool for every internal provider method.
