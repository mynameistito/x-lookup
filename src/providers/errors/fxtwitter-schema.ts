import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class FxTwitterSchemaError
  extends Data.TaggedError("FxTwitterSchemaError")<{
    readonly cause?: unknown;
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_error" as const;
  override readonly message = "FxTwitter API returned an invalid response.";
  readonly status = 502 as const;
}
