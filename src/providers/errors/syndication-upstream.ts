import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class SyndicationUpstreamError
  extends Data.TaggedError("SyndicationUpstreamError")<{
    readonly operation: "status";
    readonly status: 404 | 502;
    readonly upstreamStatus: number;
  }>
  implements HttpMappedError
{
  readonly code = "syndication_error" as const;
  override readonly message = "Post not found via syndication API.";
}
