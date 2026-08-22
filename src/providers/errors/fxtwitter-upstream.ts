import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class FxTwitterUpstreamError
  extends Data.TaggedError("FxTwitterUpstreamError")<{
    readonly operation: string;
    readonly upstreamMessage?: string;
    readonly upstreamStatus: number;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_error" as const;
  readonly status = 502 as const;

  override get message(): string {
    return `FxTwitter API error: ${this.upstreamMessage ?? this.upstreamStatus}.`;
  }
}
