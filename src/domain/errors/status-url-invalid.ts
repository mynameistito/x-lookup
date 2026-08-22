import { Data } from "effect";

export class StatusUrlInvalid extends Data.TaggedError("StatusUrlInvalid")<{
  readonly code: "invalid_url";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "Invalid URL. Provide a public X/Twitter status URL.";
}
