import { Data } from "effect";

export class StatusTargetInvalid extends Data.TaggedError(
  "StatusTargetInvalid"
)<{
  readonly code: "invalid_params";
  readonly handle: string;
  readonly id: string;
  readonly status: 400;
}> {
  override readonly message = "Missing or invalid handle/status id.";
}
