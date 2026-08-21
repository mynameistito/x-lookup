import { Effect, Layer, Result } from "effect";

import { ROOT_MARKDOWN } from "./docs.js";
import type { Env } from "./env.js";
import {
  Browse,
  browseEffect,
  browseResponse,
  layerBrowseWithoutDependencies,
} from "./lib/browse.js";
import type { BrowseFailure } from "./lib/browse.js";
import { layerWorker } from "./lib/cache.js";
import {
  acceptPrefersHtml,
  Conversion,
  convertTweetEffect,
  layerConversionWithoutDependencies,
  markdownResponse,
} from "./lib/converter.js";
import type { ConvertFailure } from "./lib/converter.js";
import {
  embedResponse,
  isEmbedUserAgent,
  oembedResponse,
} from "./lib/embed.js";
import type { OEmbedQuery } from "./lib/embed.js";
import { requestOrigin, wantsJson, wantsMarkdown } from "./lib/http.js";
import {
  layerFxTwitter,
  layerSyndication,
} from "./lib/provider-service-adapter.js";
import { layerPostLookupWithoutDependencies } from "./lib/tweet-fetch.js";

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

type RoutedResponse = Effect.Effect<Response, never, Browse | Conversion>;

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

/** Render an expected typed application failure onto the HTTP error contract. */
const errorResponse = (failure: ConvertFailure | BrowseFailure): Response =>
  jsonResponse(failure.status, {
    code: failure.code,
    error: failure.message,
  });

const originOf = (request: Request): string =>
  requestOrigin({
    headers: { host: request.headers.get("host") ?? undefined },
    protocol: new URL(request.url).protocol,
  });

const handleBrowse = (
  query: URLSearchParams,
  request: Request
): RoutedResponse =>
  Effect.gen(function* handleBrowseEffect() {
    const param = (key: string): string | undefined =>
      query.get(key) ?? undefined;
    const result = yield* Effect.result(
      browseEffect({
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
      })
    );
    if (Result.isFailure(result)) {
      return errorResponse(result.failure);
    }
    const response = browseResponse(
      result.success,
      wantsJson(param("format"), request.headers.get("accept") ?? "")
    );
    return apiResponse(response);
  });

const handleConvert = (
  query: URLSearchParams,
  request: Request
): RoutedResponse =>
  Effect.gen(function* handleConvertEffect() {
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

    const result = yield* Effect.result(
      convertTweetEffect({
        context: param("context"),
        format: param("format"),
        full: param("full"),
        handle: param("handle"),
        id: param("id"),
        nocache: param("nocache"),
        replies: param("replies"),
        thread: param("thread"),
        url: param("url"),
        userinfo: param("userinfo"),
      })
    );
    if (Result.isFailure(result)) {
      return errorResponse(result.failure);
    }

    const response = asEmbed
      ? embedResponse(result.success, { origin: originOf(request), userAgent })
      : markdownResponse(result.success, asJson, asHtml);
    return apiResponse(response);
  });

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
  request: Request
): RoutedResponse | undefined => {
  if (path === "/" || path === "/docs") {
    return Effect.succeed(textResponse(ROOT_MARKDOWN));
  }
  if (path === "/api/browse") {
    return handleBrowse(query, request);
  }
  if (path === "/api/convert") {
    return handleConvert(query, request);
  }
  if (path === "/oembed") {
    return Effect.succeed(handleOEmbed(query, request));
  }
  if (path === "/search") {
    query.set("resource", "search");
    return handleBrowse(query, request);
  }
  return undefined;
};

const handleStatusRoutes = (
  path: string,
  query: URLSearchParams,
  request: Request
): RoutedResponse | undefined => {
  const statusMatch = STATUS_ROUTE.exec(path);
  if (statusMatch) {
    query.set("handle", statusMatch[1] ?? "");
    query.set("id", statusMatch[2] ?? "");
    return handleConvert(query, request);
  }

  const listMatch = LIST_ROUTE.exec(path);
  if (listMatch) {
    query.set("resource", listMatch[2] ?? "");
    query.set("handle", listMatch[1] ?? "");
    return handleBrowse(query, request);
  }

  const profileMatch = PROFILE_ROUTE.exec(path);
  if (profileMatch) {
    query.set("resource", "profile");
    query.set("handle", profileMatch[1] ?? "");
    return handleBrowse(query, request);
  }
  return undefined;
};

const applicationLayer = (env: Env): Layer.Layer<Browse | Conversion> => {
  const cacheLayer = layerWorker(env);
  const providerLayer = Layer.mergeAll(layerFxTwitter, layerSyndication);
  const postLookupLayer = layerPostLookupWithoutDependencies.pipe(
    Layer.provide(providerLayer)
  );
  const browseLayer = layerBrowseWithoutDependencies.pipe(
    Layer.provide([cacheLayer, layerFxTwitter])
  );
  const conversionLayer = layerConversionWithoutDependencies.pipe(
    Layer.provide([cacheLayer, postLookupLayer])
  );
  return Layer.mergeAll(browseLayer, conversionLayer);
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
  const appLayer = applicationLayer(env);
  const runRoute = (route: RoutedResponse): Promise<Response> =>
    Effect.runPromise(Effect.provide(route, appLayer));

  try {
    const routed = handlePathRoutes(path, query, request);
    if (routed) {
      return await runRoute(routed);
    }
    const matched = handleStatusRoutes(path, query, request);
    if (matched) {
      return await runRoute(matched);
    }
  } catch (error) {
    // Expected failures are typed in application Effects; escaping is a defect.
    console.error(error);
    return jsonResponse(500, {
      code: "internal_error",
      error: "Internal server error",
    });
  }

  return jsonResponse(404, { code: "not_found", error: "Not found." });
};
