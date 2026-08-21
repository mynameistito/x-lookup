import { Data } from "effect";

import type { HttpMappedError } from "./errors.js";

/** FxTwitter could not be reached through the configured HTTP transport. */
export class FxTwitterNetworkError
  extends Data.TaggedError("FxTwitterNetworkError")<{
    readonly cause?: unknown;
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_network" as const;
  override readonly message = "Failed to reach FxTwitter API.";
  readonly status = 502 as const;
}

/** FxTwitter returned a body that was not JSON. */
export class FxTwitterNonJsonError
  extends Data.TaggedError("FxTwitterNonJsonError")<{
    readonly cause?: unknown;
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_error" as const;
  override readonly message = "FxTwitter API returned a non-JSON response.";
  readonly status = 502 as const;
}

/** FxTwitter returned JSON that did not match the transport shape we consume. */
export class FxTwitterSchemaError
  extends Data.TaggedError("FxTwitterSchemaError")<{
    readonly cause?: unknown;
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_error" as const;
  override readonly message = "FxTwitter API returned an invalid response.";
  readonly status = 502 as const;
}

/** FxTwitter explicitly classified the requested content as unavailable. */
export class FxTwitterNotFoundError
  extends Data.TaggedError("FxTwitterNotFoundError")<{
    readonly kind: "post" | "profile" | "provider";
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "not_found" as const;
  readonly status = 404 as const;

  override get message(): string {
    if (this.kind === "profile") {
      return "Profile not found.";
    }
    if (this.kind === "post") {
      return "Post not found.";
    }
    return "Post not found or unavailable.";
  }
}

/** FxTwitter reported that the requested post is private. */
export class FxTwitterPrivateTweetError
  extends Data.TaggedError("FxTwitterPrivateTweetError")<{
    readonly operation: string;
  }>
  implements HttpMappedError
{
  readonly code = "private_tweet" as const;
  override readonly message = "Post is private and cannot be fetched.";
  readonly status = 404 as const;
}

/** FxTwitter returned a known provider/HTTP failure other than missing/private. */
export class FxTwitterUpstreamError
  extends Data.TaggedError("FxTwitterUpstreamError")<{
    readonly operation: string;
    readonly upstreamMessage?: string;
    readonly upstreamStatus: number;
  }>
  implements HttpMappedError
{
  readonly code = "fxtwitter_error" as const;
  readonly status = 502 as const;

  override get message(): string {
    return `FxTwitter API error: ${this.upstreamMessage ?? this.upstreamStatus}.`;
  }
}

/** FxTwitter refuses search from the current upstream environment. */
export class FxTwitterSearchUnavailableError
  extends Data.TaggedError("FxTwitterSearchUnavailableError")<{
    readonly operation: "search";
  }>
  implements HttpMappedError
{
  readonly code = "search_unavailable" as const;
  override readonly message = "X search is unavailable upstream.";
  readonly status = 502 as const;
}

/** X syndication could not be reached through the configured HTTP transport. */
export class SyndicationNetworkError
  extends Data.TaggedError("SyndicationNetworkError")<{
    readonly cause?: unknown;
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_network" as const;
  override readonly message = "Failed to reach X syndication API.";
  readonly status = 502 as const;
}

/** X syndication returned a non-success HTTP status. */
export class SyndicationUpstreamError
  extends Data.TaggedError("SyndicationUpstreamError")<{
    readonly operation: "status";
    readonly status: 404 | 502;
    readonly upstreamStatus: number;
  }>
  implements HttpMappedError
{
  readonly code = "syndication_error" as const;
  override readonly message = "Post not found via syndication API.";
}

/** X syndication returned a body that was not JSON. */
export class SyndicationNonJsonError
  extends Data.TaggedError("SyndicationNonJsonError")<{
    readonly cause?: unknown;
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_error" as const;
  override readonly message = "X syndication API returned a non-JSON response.";
  readonly status = 502 as const;
}

/** X syndication returned JSON that did not match the transport shape we consume. */
export class SyndicationSchemaError
  extends Data.TaggedError("SyndicationSchemaError")<{
    readonly cause?: unknown;
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_error" as const;
  override readonly message = "X syndication API returned an invalid response.";
  readonly status = 502 as const;
}

/** X syndication returned an empty tweet-result document. */
export class SyndicationEmptyError
  extends Data.TaggedError("SyndicationEmptyError")<{
    readonly operation: "status";
  }>
  implements HttpMappedError
{
  readonly code = "syndication_empty" as const;
  override readonly message = "Post not found via syndication API.";
  readonly status = 404 as const;
}

export type FxTwitterFailure =
  | FxTwitterNetworkError
  | FxTwitterNonJsonError
  | FxTwitterNotFoundError
  | FxTwitterPrivateTweetError
  | FxTwitterSchemaError
  | FxTwitterSearchUnavailableError
  | FxTwitterUpstreamError;

export type SyndicationFailure =
  | SyndicationEmptyError
  | SyndicationNetworkError
  | SyndicationNonJsonError
  | SyndicationSchemaError
  | SyndicationUpstreamError;

export type ProviderFailure = FxTwitterFailure | SyndicationFailure;

const PROVIDER_FAILURE_TAGS = new Set([
  "FxTwitterNetworkError",
  "FxTwitterNonJsonError",
  "FxTwitterNotFoundError",
  "FxTwitterPrivateTweetError",
  "FxTwitterSchemaError",
  "FxTwitterSearchUnavailableError",
  "FxTwitterUpstreamError",
  "SyndicationEmptyError",
  "SyndicationNetworkError",
  "SyndicationNonJsonError",
  "SyndicationSchemaError",
  "SyndicationUpstreamError",
]);

/** Narrow an unknown failure to the provider failures owned by these adapters. */
export const isProviderFailure = (value: unknown): value is ProviderFailure =>
  value instanceof Error &&
  "_tag" in value &&
  typeof value._tag === "string" &&
  PROVIDER_FAILURE_TAGS.has(value._tag);
