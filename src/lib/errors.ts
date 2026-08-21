/**
 * The external HTTP error contract every expected failure projects onto:
 * JSON `{ "error": string, "code": string }` with a truthful status.
 *
 * The tagged domain parse errors and the legacy `ConvertError` both satisfy
 * this structurally, so the HTTP boundary renders any expected failure
 * union without knowing its member modules.
 */
export interface HttpMappedError {
  /** Stable external error code, e.g. `invalid_url`. */
  readonly code: string;
  /** HTTP status that truthfully reflects the failure class. */
  readonly status: number;
}

/**
 * A failure of one of the free upstream providers (FxTwitter, syndication).
 *
 * Networking failures are not part of the Effect Schema parsing migration
 * yet; they keep this exception-style carrier until the provider adapters
 * migrate. Every construction site supplies a truthful status and a stable
 * external code.
 */
export class ConvertError extends Error implements HttpMappedError {
  readonly code: string;
  readonly status: number;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "ConvertError";
    this.code = code;
    this.status = status;
  }
}
