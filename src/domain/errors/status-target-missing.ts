import { Data } from "effect";

export class StatusTargetMissing extends Data.TaggedError(
  "StatusTargetMissing"
)<{
  readonly code: "missing_url";
  readonly status: 400;
}> {
  override readonly message = "Missing required `url` query parameter.";
}
