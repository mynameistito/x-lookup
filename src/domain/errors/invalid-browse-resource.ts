import { Data } from "effect";

export class InvalidBrowseResource extends Data.TaggedError(
  "InvalidBrowseResource"
)<{
  readonly code: "invalid_resource";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message = "Unsupported browse resource.";
}
