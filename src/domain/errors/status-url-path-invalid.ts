import { Data } from "effect";

export class StatusUrlPathInvalid extends Data.TaggedError(
  "StatusUrlPathInvalid"
)<{
  readonly code: "invalid_path";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "URL must be a status permalink like https://x.com/handle/status/1234567890.";
}
