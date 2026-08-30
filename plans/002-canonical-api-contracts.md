# Plan 002: Establish one contract source for HTTP, MCP, and OpenAPI

> **Executor instructions**: Follow this plan step by step. Touch only the listed files. Do not update `plans/README.md`; the reviewer maintains that index.
>
> **Drift check**: `git diff --stat fa6aeba..HEAD -- src/application/browse.ts src/application/conversion.ts src/http/routes/application.ts src/mcp/server.ts src/metadata/api-catalog.ts __tests__`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-structured-mcp-output.md`
- **Category**: tech-debt
- **Planned at**: commit `fa6aeba`, 2026-08-30

## Why this matters

HTTP parsing, MCP Zod schemas, OpenAPI metadata, README, and generated docs describe the same operations independently. This makes parameter changes easy to apply incompletely. Consolidate executable contracts around the existing domain/application parsers and add drift tests before attempting broad generation.

## Current state

- `src/http/routes/application.ts:26-60` maps URL query strings to raw application inputs.
- `src/application/browse.ts:148-169` and `src/application/conversion.ts:108-130` are the canonical domain parsing boundaries.
- `src/mcp/server.ts:24-135` separately defines MCP input schemas.
- `src/metadata/api-catalog.ts:88-200` separately defines OpenAPI parameter metadata.
- Use the existing Effect `Result` parsing model and avoid passing schema-inferred transport types through application services.

## Commands

| Purpose | Command | Expected |
| --- | --- | --- |
| Tests | `bun run test -- __tests__/browse-query.test.ts __tests__/convert-query.test.ts __tests__/mcp-server.test.ts __tests__/router.test.ts` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Check | `bun run check` | no warnings/errors |

## Scope

**In scope**: contract definitions/adapters in `src/domain/`, `src/mcp/server.ts`, `src/metadata/api-catalog.ts`, and contract tests under `__tests__/`.

**Out of scope**: changing defaults, accepted values, public JSON response fields, README wording, provider behavior, or removing compatibility aliases.

## Steps

### Step 1: Inventory and name the canonical operation contract

Define a small contract representation for operation names, parameter names, defaults, enums, descriptions, and limits. Keep semantic parsing in the existing domain parsers. If a full shared schema would require weakening typed domain errors or duplicating Zod/Effect codecs, use a metadata contract plus adapters rather than forcing one library everywhere.

**Verify**: `bun run typecheck` -> exit 0.

### Step 2: Drive MCP and OpenAPI metadata from the contract

Replace duplicated parameter literals where practical. MCP may retain Zod-specific wrappers; OpenAPI may retain JSON-specific projections. Ensure both expose the same names, defaults, ranges, and descriptions as the application parser.

**Verify**: `bun run test -- __tests__/mcp-server.test.ts __tests__/router.test.ts` -> all pass.

### Step 3: Add contract drift tests

Add tests that compare the documented parameter sets for browse, search, profile, follower/following, and conversion operations with the canonical contract. Include the important distinction that HTTP values arrive as strings while MCP values are typed. Test `@handle` normalization and cursor/page/limit defaults against existing behavior.

**Verify**: `bun run test -- __tests__/browse-query.test.ts __tests__/convert-query.test.ts __tests__/mcp-server.test.ts __tests__/router.test.ts` -> all pass.

## Done criteria

- [ ] Canonical contract metadata exists for every public application operation.
- [ ] MCP and OpenAPI parameter sets are tested against it.
- [ ] Existing defaults and error codes are unchanged.
- [ ] Full `bun run test`, `bun run typecheck`, and `bun run check` pass.

## STOP conditions

- The chosen contract representation requires changing a public default or error precedence.
- OpenAPI generation would require adding a dependency without an approved reason.
- The implementation needs README/docs edits outside the scope; report the exact required drift instead.

## Maintenance notes

Any new route or MCP tool must first add its operation contract, then its protocol projection and tests. Keep protocol-specific parsing at the boundary.
