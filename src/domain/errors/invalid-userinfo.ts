import { Data } from "effect";

export class InvalidUserinfo extends Data.TaggedError("InvalidUserinfo")<{
  readonly code: "invalid_userinfo";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "`userinfo` must be `off`, `author`, or `all`.";
}
