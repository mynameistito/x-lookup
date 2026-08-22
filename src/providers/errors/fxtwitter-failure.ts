import type { FxTwitterNetworkError } from "@/providers/errors/fxtwitter-network.ts";
import type { FxTwitterNonJsonError } from "@/providers/errors/fxtwitter-non-json.ts";
import type { FxTwitterNotFoundError } from "@/providers/errors/fxtwitter-not-found.ts";
import type { FxTwitterPrivateTweetError } from "@/providers/errors/fxtwitter-private.ts";
import type { FxTwitterSchemaError } from "@/providers/errors/fxtwitter-schema.ts";
import type { FxTwitterSearchUnavailableError } from "@/providers/errors/fxtwitter-search.ts";
import type { FxTwitterUpstreamError } from "@/providers/errors/fxtwitter-upstream.ts";

export type FxTwitterFailure =
  | FxTwitterNetworkError
  | FxTwitterNonJsonError
  | FxTwitterNotFoundError
  | FxTwitterPrivateTweetError
  | FxTwitterSchemaError
  | FxTwitterSearchUnavailableError
  | FxTwitterUpstreamError;
