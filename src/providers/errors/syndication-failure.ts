import type { SyndicationEmptyError } from "@/providers/errors/syndication-empty.ts";
import type { SyndicationNetworkError } from "@/providers/errors/syndication-network.ts";
import type { SyndicationNonJsonError } from "@/providers/errors/syndication-non-json.ts";
import type { SyndicationSchemaError } from "@/providers/errors/syndication-schema.ts";
import type { SyndicationUpstreamError } from "@/providers/errors/syndication-upstream.ts";

export type SyndicationFailure =
  | SyndicationEmptyError
  | SyndicationNetworkError
  | SyndicationNonJsonError
  | SyndicationSchemaError
  | SyndicationUpstreamError;
