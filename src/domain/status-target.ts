import { Data, Option, Result } from "effect";

import { digitsOf, parse as parsePostId } from "@/domain/post-id.ts";
import type { PostId } from "@/domain/post-id.ts";

/** A resolved status request target. */
export interface StatusTarget {
  /**
   * Canonical `https://x.com/{handle}/status/{id}` form of the target,
   * rebuilt from the parsed handle and id.
   */
  readonly canonicalUrl: string;
  /**
   * The handle token as it is used for the canonical URL and the syndication
   * fallback. The status permalink shape accepts any non-empty path segment,
   * so this is deliberately a plain string, not an `XHandle`.
   */
  readonly handle: string;
  /** The parsed numeric post id. */
  readonly id: PostId;
}

/** The URL text could not be parsed as a URL at all. */
export class StatusUrlInvalid extends Data.TaggedError("StatusUrlInvalid")<{
  readonly code: "invalid_url";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "Invalid URL. Provide a public X/Twitter status URL.";
}

/** The URL parses but its host is not an accepted X/Twitter (or self) host. */
export class StatusUrlHostUnsupported extends Data.TaggedError(
  "StatusUrlHostUnsupported"
)<{
  readonly code: "unsupported_host";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "Only x.com or twitter.com status URLs are supported.";
}

/** The URL host is accepted but the path is not a status permalink. */
export class StatusUrlPathInvalid extends Data.TaggedError(
  "StatusUrlPathInvalid"
)<{
  readonly code: "invalid_path";
  readonly input: string;
  readonly status: 400;
}> {
  override readonly message =
    "URL must be a status permalink like https://x.com/handle/status/1234567890.";
}

/**
 * Both `handle` and `id` were supplied but at least one normalizes to
 * nothing (no digits for the id, or an empty handle after de-`@`-ing).
 */
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

/** Neither a `url` nor a `handle`+`id` pair was supplied. */
export class StatusTargetMissing extends Data.TaggedError(
  "StatusTargetMissing"
)<{
  readonly code: "missing_url";
  readonly status: 400;
}> {
  override readonly message = "Missing required `url` query parameter.";
}

/** Every way {@link parseStatusUrl} can refuse its input. */
export type StatusUrlError =
  | StatusUrlHostUnsupported
  | StatusUrlInvalid
  | StatusUrlPathInvalid;

/** Every way {@link resolve} can refuse its input. */
export type ResolveError =
  | StatusUrlError
  | StatusTargetInvalid
  | StatusTargetMissing;

const ALLOWED_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x-lookup.mynameistito.com",
]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const STATUS_PATH = /^\/(?<handle>[^/?#]+)\/status\/(?<id>\d+)\/?$/u;

const hostAllowed = (host: string): boolean =>
  ALLOWED_HOSTS.has(host) ||
  LOCAL_HOSTS.has(host) ||
  host.endsWith(".workers.dev");

/**
 * Parse a status permalink into a canonical target.
 *
 * Accepts `x.com`, `twitter.com` (including `www.`/`mobile.` subdomains),
 * this service's production host, localhost previews, and `*.workers.dev`
 * preview hosts — exactly the historical allowlist. The handle segment is
 * any non-empty path token; the id must be digits.
 *
 * @param raw - The untrusted URL text (trimmed before parsing).
 * @returns The canonical target, or a precise `StatusUrlError`.
 */
export const parseStatusUrl = (
  raw: string
): Result.Result<StatusTarget, StatusUrlError> => {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return Result.fail(
      new StatusUrlInvalid({ code: "invalid_url", input: raw, status: 400 })
    );
  }

  const host = parsed.hostname.replace(/^www\./u, "");
  if (!hostAllowed(host)) {
    return Result.fail(
      new StatusUrlHostUnsupported({
        code: "unsupported_host",
        input: raw,
        status: 400,
      })
    );
  }

  const match = STATUS_PATH.exec(parsed.pathname);
  const handle = match?.groups?.handle ?? "";
  const id = Option.getOrUndefined(parsePostId(match?.groups?.id ?? ""));
  if (!handle || id === undefined) {
    return Result.fail(
      new StatusUrlPathInvalid({
        code: "invalid_path",
        input: raw,
        status: 400,
      })
    );
  }

  return Result.succeed({
    canonicalUrl: `https://x.com/${handle}/status/${id}`,
    handle,
    id,
  });
};

/** Raw `handle`/`id`/`url` query values of a convert request. */
export interface TargetInput {
  readonly handle?: string | null;
  readonly id?: string | null;
  readonly url?: string | null;
}

/**
 * Resolve the request target from raw query values.
 *
 * Precedence matches the historical behavior: an explicit `url` wins;
 * otherwise a `handle`+`id` pair is normalized (`@` stripped from the
 * handle, non-digits dropped from the id); anything else is missing.
 *
 * @param input - The raw target query values.
 * @returns The canonical target, or a precise resolve error.
 */
export const resolve = (
  input: TargetInput
): Result.Result<StatusTarget, ResolveError> => {
  if (input.url) {
    return parseStatusUrl(input.url);
  }

  if (input.handle && input.id) {
    const handle = input.handle.replace(/^@/u, "");
    const id = Option.getOrUndefined(digitsOf(input.id));
    if (!handle || id === undefined) {
      return Result.fail(
        new StatusTargetInvalid({
          code: "invalid_params",
          handle: input.handle,
          id: input.id,
          status: 400,
        })
      );
    }
    return Result.succeed({
      canonicalUrl: `https://x.com/${handle}/status/${id}`,
      handle,
      id,
    });
  }

  return Result.fail(
    new StatusTargetMissing({ code: "missing_url", status: 400 })
  );
};
