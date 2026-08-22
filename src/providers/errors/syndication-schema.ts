import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class SyndicationSchemaError
  extends Data.TaggedError("SyndicationSchemaError")<{
    readonly cause?: unknown;
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_error" as const;
  override readonly message = "X syndication API returned an invalid response.";
  readonly status = 502 as const;
}
