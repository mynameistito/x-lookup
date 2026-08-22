import { Data } from "effect";

export class MissingSearchQuery extends Data.TaggedError("MissingSearchQuery")<{
  readonly code: "missing_query";
  readonly status: 400;
}> {
  override readonly message = "Search query q is required.";
}
