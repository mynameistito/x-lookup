export { FxTwitterNetworkError } from "@/providers/errors/fxtwitter-network.ts";
export { FxTwitterNonJsonError } from "@/providers/errors/fxtwitter-non-json.ts";
export { FxTwitterNotFoundError } from "@/providers/errors/fxtwitter-not-found.ts";
export { FxTwitterPrivateTweetError } from "@/providers/errors/fxtwitter-private.ts";
export { FxTwitterSchemaError } from "@/providers/errors/fxtwitter-schema.ts";
export { FxTwitterSearchUnavailableError } from "@/providers/errors/fxtwitter-search.ts";
export { FxTwitterUpstreamError } from "@/providers/errors/fxtwitter-upstream.ts";
export { SyndicationEmptyError } from "@/providers/errors/syndication-empty.ts";
export { SyndicationNetworkError } from "@/providers/errors/syndication-network.ts";
export { SyndicationNonJsonError } from "@/providers/errors/syndication-non-json.ts";
export { SyndicationSchemaError } from "@/providers/errors/syndication-schema.ts";
export { SyndicationUpstreamError } from "@/providers/errors/syndication-upstream.ts";

/** The HTTP shape expected failures expose at the application boundary. */
export interface HttpMappedError {
  readonly code: string;
  readonly status: number;
}

export type { FxTwitterFailure } from "@/providers/errors/fxtwitter-failure.ts";
export type { SyndicationFailure } from "@/providers/errors/syndication-failure.ts";
export type { ProviderFailure } from "@/providers/errors/provider-failure.ts";
