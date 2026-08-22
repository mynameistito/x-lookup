import { Data } from "effect";

import type { HttpMappedError } from "@/providers/errors.ts";

export class FxTwitterNotFoundError
  extends Data.TaggedError("FxTwitterNotFoundError")<{
    readonly kind: "post" | "profile" | "provider";
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "not_found" as const;
  readonly status = 404 as const;

  override get message(): string {
    if (this.kind === "profile") {
      return "Profile not found.";
    }
    if (this.kind === "post") {
      return "Post not found.";
    }
    return "Post not found or unavailable.";
  }
}
