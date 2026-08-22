import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class SyndicationNonJsonError
  extends Data.TaggedError("SyndicationNonJsonError")<{
    readonly cause?: unknown;
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_error" as const;
  override readonly message = "X syndication API returned a non-JSON response.";
  readonly status = 502 as const;
}
