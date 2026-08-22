import { Data } from "effect";

export class InvalidReplies extends Data.TaggedError("InvalidReplies")<{
  readonly code: "invalid_replies";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "`replies` must be `top`, `recent`, or `off`.";
}
