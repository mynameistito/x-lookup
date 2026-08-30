import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

/** Maximum number of upstream requests one uncached operation may perform. */
export const MAX_UPSTREAM_CALLS = 3;

/** Maximum number of pages a browse operation may walk without a cursor. */
export const MAX_BROWSE_PAGE_WALK = 3;

/** A typed refusal raised before an operation can exceed its upstream budget. */
export class UpstreamWorkLimitError
  extends Data.TaggedError("UpstreamWorkLimitError")<{
    readonly operation: "browse" | "convert";
    readonly requested: number;
    readonly limit: number;
  }>
  implements HttpMappedError
{
  readonly code = "upstream_work_limit" as const;
  readonly status = 429 as const;
  override readonly message =
    "This request would exceed the anonymous upstream work limit.";
}

/** Calculate worst-case browse upstream calls for a parsed request. */
export const browseUpstreamCalls = (
  page: number,
  hasCursor: boolean,
  isProfile: boolean
): number => (hasCursor ? 1 : page) + (isProfile ? 1 : 0);

/** Refuse a planned operation when its worst-case work exceeds the budget. */
export const enforceUpstreamCallBudget = (
  operation: "browse" | "convert",
  requested: number
): UpstreamWorkLimitError | undefined =>
  requested > MAX_UPSTREAM_CALLS
    ? new UpstreamWorkLimitError({
        limit: MAX_UPSTREAM_CALLS,
        operation,
        requested,
      })
    : undefined;
