import { Data } from "effect";

export class StatusUrlHostUnsupported extends Data.TaggedError(
  "StatusUrlHostUnsupported"
)<{
  readonly code: "unsupported_host";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "Only x.com or twitter.com status URLs are supported.";
}
