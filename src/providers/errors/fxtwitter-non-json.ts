import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class FxTwitterNonJsonError
  extends Data.TaggedError("FxTwitterNonJsonError")<{
    readonly cause?: unknown;
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_error" as const;
  override readonly message = "FxTwitter API returned a non-JSON response.";
  readonly status = 502 as const;
}
