import { Data } from "effect";

export class InvalidContext extends Data.TaggedError("InvalidContext")<{
  readonly code: "invalid_context";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "`context` must be `full` or `thread`.";
}
