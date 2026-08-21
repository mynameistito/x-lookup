export const DEFAULT_ORIGIN = "https://x-lookup.mynameistito.com";

const KNOWN_HOSTS = new Set([
  "x-lookup.mynameistito.com",
  "localhost",
  "127.0.0.1",
]);

export interface OriginRequest {
  headers: {
    host?: string | string[];
    "x-forwarded-proto"?: string | string[];
    "x-forwarded-host"?: string | string[];
  };
  protocol?: string;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hostnameOf(host: string | undefined): string | undefined {
  if (!host) {return undefined;}
  return host.split(",")[0]?.trim().replace(/:\d+$/, "") || undefined;
}

function requestProtocol(req: OriginRequest): "http" | "https" {
  const forwarded = headerValue(req.headers["x-forwarded-proto"])
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwarded === "http" || forwarded === "https") {return forwarded;}
  if (req.protocol === "http:" || req.protocol === "http") {return "http";}
  return "https";
}

/** Resolve a safe origin for absolute links; only known hosts are honored. */
export function requestOrigin(
  req: OriginRequest,
  fallback = DEFAULT_ORIGIN
): string {
  const hostHeader = headerValue(req.headers.host);
  const hostname = hostnameOf(hostHeader);
  if (hostname && KNOWN_HOSTS.has(hostname)) {
    return `${requestProtocol(req)}://${hostHeader}`;
  }
  return fallback;
}

export function wantsJson(
  format: string | null | undefined,
  accept: string
): boolean {
  if (format) {return format === "json";}
  return accept.includes("application/json");
}

export function wantsMarkdown(
  format: string | null | undefined,
  accept: string
): boolean {
  if (format) {return format === "markdown" || format === "obsidian";}
  return accept.includes("text/markdown");
}
