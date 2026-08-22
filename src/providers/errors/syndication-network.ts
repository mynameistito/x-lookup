import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class SyndicationNetworkError
  extends Data.TaggedError("SyndicationNetworkError")<{
    readonly cause?: unknown;
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_network" as const;
  override readonly message = "Failed to reach X syndication API.";
  readonly status = 502 as const;
}
