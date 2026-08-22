import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class FxTwitterSearchUnavailableError
  extends Data.TaggedError("FxTwitterSearchUnavailableError")<{
    readonly operation: "search";
  }>
  implements HttpMappedError
{
  readonly code = "search_unavailable" as const;
  override readonly message = "X search is unavailable upstream.";
  readonly status = 502 as const;
}
