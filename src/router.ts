import { ROOT_MARKDOWN } from "./docs.js";
import type { Env } from "./env.js";
import { browse, browseResponse } from "./lib/browse.js";
import { workerConfig } from "./lib/cache.js";
import type { RuntimeConfig } from "./lib/cache.js";
import {
  ConvertError,
  acceptPrefersHtml,
  convertTweet,
  markdownResponse,
} from "./lib/converter.js";
import {
  embedResponse,
  isEmbedUserAgent,
  oembedResponse,
} from "./lib/embed.js";
import type { OEmbedQuery } from "./lib/embed.js";
import { requestOrigin, wantsJson, wantsMarkdown } from "./lib/http.js";

const HANDLE = "([A-Za-z0-9_]{1,15})";
const STATUS_ROUTE = new RegExp(`^/${HANDLE}/status/(\\d+)$`, "u");
const LIST_ROUTE = new RegExp(`^/${HANDLE}/(followers|following)$`, "u");
const PROFILE_ROUTE = new RegExp(`^/${HANDLE}$`, "u");

interface ApiErrorBody {
  code?: string;
  error: string;
}

interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

const jsonResponse = (status: number, body: ApiErrorBody): Response =>
  Response.json(body, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });

const apiResponse = (result: ApiResponse): Response => {
  const headers = new Headers(result.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Accept, Content-Type");
  return new Response(result.body ?? null, { headers, status: result.status });
};

const textResponse = (body: string): Response =>
  new Response(body, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
    status: 200,
  });

const fail = (error: ConvertError | Error): Response => {
  if (error instanceof ConvertError) {
    return jsonResponse(error.status, {
      code: error.code,
      error: error.message,
    });
  }
  console.error(error);
  return jsonResponse(500, {
    code: "internal_error",
    error: "Internal server error",
  });
};

const originOf = (request: Request): string =>
  requestOrigin({
    headers: { host: request.headers.get("host") ?? undefined },
    protocol: new URL(request.url).protocol,
  });

const handleBrowse = async (
  query: URLSearchParams,
  request: Request,
  config: RuntimeConfig
): Promise<Response> => {
  const param = (key: string): string | undefined =>
    query.get(key) ?? undefined;
  const result = await browse(
    {
      cursor: param("cursor"),
      feed: param("feed"),
      format: param("format"),
      full: param("full"),
      handle: param("handle"),
      limit: param("limit"),
      nocache: param("nocache"),
      page: param("page"),
      q: param("q"),
      resource: param("resource"),
    },
    config
  );
  const response = browseResponse(
    result,
    wantsJson(param("format"), request.headers.get("accept") ?? "")
  );
  return apiResponse(response);
};

const handleConvert = async (
  query: URLSearchParams,
  request: Request,
  config: RuntimeConfig
): Promise<Response> => {
  const param = (key: string): string | undefined =>
    query.get(key) ?? undefined;
  const accept = request.headers.get("accept") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  const requestedFormat = param("format");
  const asJson = wantsJson(requestedFormat, accept);
  const asMarkdown = wantsMarkdown(requestedFormat, accept);
  const noExplicitFormat = !requestedFormat && !asJson && !asMarkdown;
  const asEmbed = noExplicitFormat && isEmbedUserAgent(userAgent);
  const asHtml = noExplicitFormat && !asEmbed && acceptPrefersHtml(accept);

  const result = await convertTweet(
    {
      context: param("context"),
      format: requestedFormat,
      full: param("full"),
      handle: param("handle"),
      id: param("id"),
      nocache: param("nocache"),
      replies: param("replies"),
      thread: param("thread"),
      url: param("url"),
      userinfo: param("userinfo"),
    },
    config
  );

  const response = asEmbed
    ? embedResponse(result, { origin: originOf(request), userAgent })
    : markdownResponse(result, asJson, asHtml);
  return apiResponse(response);
};

const handleOEmbed = (query: URLSearchParams, request: Request): Response => {
  const param = (key: string): string | undefined =>
    query.get(key) ?? undefined;
  const oembedQuery: OEmbedQuery = {
    author: param("author"),
    provider: param("provider"),
    status: param("status"),
    text: param("text"),
    url: param("url"),
  };
  return apiResponse(oembedResponse(oembedQuery, originOf(request)));
};

const handlePathRoutes = (
  path: string,
  query: URLSearchParams,
  request: Request,
  config: RuntimeConfig
): Promise<Response> | Response | undefined => {
  if (path === "/" || path === "/docs") {
    return textResponse(ROOT_MARKDOWN);
  }
  if (path === "/api/browse") {
    return handleBrowse(query, request, config);
  }
  if (path === "/api/convert") {
    return handleConvert(query, request, config);
  }
  if (path === "/oembed") {
    return handleOEmbed(query, request);
  }
  if (path === "/search") {
    query.set("resource", "search");
    return handleBrowse(query, request, config);
  }
  return undefined;
};

const handleStatusRoutes = (
  path: string,
  query: URLSearchParams,
  request: Request,
  config: RuntimeConfig
): Promise<Response> | undefined => {
  const statusMatch = STATUS_ROUTE.exec(path);
  if (statusMatch) {
    query.set("handle", statusMatch[1] ?? "");
    query.set("id", statusMatch[2] ?? "");
    return handleConvert(query, request, config);
  }

  const listMatch = LIST_ROUTE.exec(path);
  if (listMatch) {
    query.set("resource", listMatch[2] ?? "");
    query.set("handle", listMatch[1] ?? "");
    return handleBrowse(query, request, config);
  }

  const profileMatch = PROFILE_ROUTE.exec(path);
  if (profileMatch) {
    query.set("resource", "profile");
    query.set("handle", profileMatch[1] ?? "");
    return handleBrowse(query, request, config);
  }
  return undefined;
};

export const handleRequest = async (
  request: Request,
  env: Env = {}
): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Headers": "Accept, Content-Type",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      },
      status: 204,
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse(405, {
      code: "method_not_allowed",
      error: "Method not allowed",
    });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  const query = url.searchParams;
  const config = workerConfig(env);

  try {
    const routed = handlePathRoutes(path, query, request, config);
    if (routed) {
      return await routed;
    }
    const matched = handleStatusRoutes(path, query, request, config);
    if (matched) {
      return await matched;
    }
  } catch (error) {
    // SAFETY: handler failures are ConvertError or Error; fail() normalizes
    // anything unexpected into a truthful 500.
    return fail(error as Error);
  }

  return jsonResponse(404, { code: "not_found", error: "Not found." });
};
