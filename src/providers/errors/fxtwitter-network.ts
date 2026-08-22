import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class FxTwitterNetworkError
  extends Data.TaggedError("FxTwitterNetworkError")<{
    readonly cause?: unknown;
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_network" as const;
  override readonly message = "Failed to reach FxTwitter API.";
  readonly status = 502 as const;
}
