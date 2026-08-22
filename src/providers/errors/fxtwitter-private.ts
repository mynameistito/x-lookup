import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class FxTwitterPrivateTweetError
  extends Data.TaggedError("FxTwitterPrivateTweetError")<{
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "private_tweet" as const;
  override readonly message = "Post is private and cannot be fetched.";
  readonly status = 404 as const;
}
