import { Data } from "effect";

/**
 * The external HTTP error contract every expected failure projects onto:
 * JSON `{ "error": string, "code": string }` with a truthful status.
 *
 * Provider failures satisfy this structurally, so the HTTP boundary renders
 * any expected failure union without knowing its member modules.
 */
export interface HttpMappedError {
  /** Stable external error code, e.g. `invalid_url`. */
  readonly code: string;
  /** HTTP status that truthfully reflects the failure class. */
  readonly status: number;
}

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
