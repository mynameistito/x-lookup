import { Data } from "effect";

export class InvalidBrowseFormat extends Data.TaggedError(
  "InvalidBrowseFormat"
)<{
  readonly code: "invalid_format";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "Browse `format` must be `markdown` or `json`.";
}
