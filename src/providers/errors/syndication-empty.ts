import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class SyndicationEmptyError
  extends Data.TaggedError("SyndicationEmptyError")<{
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_empty" as const;
  override readonly message = "Post not found via syndication API.";
  readonly status = 404 as const;
}
