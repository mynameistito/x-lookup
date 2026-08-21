import { Effect, Result } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ROOT_MARKDOWN } from "./docs.js";
import {
  browseResponse,
  parseBrowseRequest,
} from "./lib/browse.js";
import type {
  BrowseFailure,
  BrowseInput,
  BrowseService,
} from "./lib/browse.js";
import {
  acceptPrefersHtml,
  markdownResponse,
  parseConvertRequest,
} from "./lib/converter.js";
import type {
  ConversionService,
  ConvertFailure,
  ConvertInput,
} from "./lib/converter.js";
import {
  embedResponse,
  isEmbedUserAgent,
  oembedResponse,
} from "./lib/embed.js";
import type { OEmbedQuery } from "./lib/embed.js";
import type { HttpPayload } from "./lib/http.js";
import { requestOrigin, wantsJson, wantsMarkdown } from "./lib/http.js";

const HANDLE = "([A-Za-z0-9_]{1,15})";
const STATUS_ROUTE = new RegExp(`^/${HANDLE}/status/(\\d+)$`, "u");
const LIST_ROUTE = new RegExp(`^/${HANDLE}/(followers|following)$`, "u");
const PROFILE_ROUTE = new RegExp(`^/${HANDLE}$`, "u");

const API_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

interface ApiErrorBody {
  readonly code: string;
  readonly error: string;
}

export interface HttpApplicationServices {
  readonly browse: BrowseService;
  readonly conversion: ConversionService;
}

type BoundaryFailure = BrowseFailure | ConvertFailure;
type RoutedPayload = Effect.Effect<HttpPayload, BoundaryFailure>;

const param = (query: URLSearchParams, key: string): string | undefined =>
  query.get(key) ?? undefined;

const jsonErrorPayload = (
  status: number,
  body: ApiErrorBody
): HttpPayload => ({
  body: JSON.stringify(body),
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  },
  status,
});

const withApiCors = (payload: HttpPayload): HttpPayload => ({
  ...payload,
  headers: {
    ...payload.headers,
    ...API_CORS_HEADERS,
  },
});

const docsPayload = (): HttpPayload => ({
  body: ROOT_MARKDOWN,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "text/markdown; charset=utf-8",
  },
  status: 200,
});

/** Translate every expected domain/application/provider failure in one place. */
const failurePayload = (failure: BoundaryFailure): HttpPayload =>
  jsonErrorPayload(failure.status, {
    code: failure.code,
    error: failure.message,
  });

const serverResponse = (
  payload: HttpPayload,
  withoutBody: boolean
): HttpServerResponse.HttpServerResponse => {
  const options = {
    headers: payload.headers,
    status: payload.status,
  };
  return withoutBody
    ? HttpServerResponse.empty(options)
    : HttpServerResponse.text(payload.body, options);
};

const originOf = (request: HttpServerRequest.HttpServerRequest): string =>
  requestOrigin({
    headers: { host: request.headers.host },
    protocol: new URL(request.originalUrl).protocol,
  });

const browseInput = (
  query: URLSearchParams,
  overrides: Partial<BrowseInput> = {}
): BrowseInput => ({
  cursor: param(query, "cursor"),
  feed: param(query, "feed"),
  format: param(query, "format"),
  full: param(query, "full"),
  handle: param(query, "handle"),
  limit: param(query, "limit"),
  nocache: param(query, "nocache"),
  page: param(query, "page"),
  q: param(query, "q"),
  resource: param(query, "resource"),
  ...overrides,
});

const convertInput = (
  query: URLSearchParams,
  overrides: Partial<ConvertInput> = {}
): ConvertInput => ({
  context: param(query, "context"),
  format: param(query, "format"),
  full: param(query, "full"),
  handle: param(query, "handle"),
  id: param(query, "id"),
  nocache: param(query, "nocache"),
  replies: param(query, "replies"),
  thread: param(query, "thread"),
  url: param(query, "url"),
  userinfo: param(query, "userinfo"),
  ...overrides,
});

const handleBrowse = (
  input: BrowseInput,
  request: HttpServerRequest.HttpServerRequest,
  services: HttpApplicationServices
): RoutedPayload =>
  Effect.gen(function* handleBrowseEffect() {
    const parsed = parseBrowseRequest(input);
    if (Result.isFailure(parsed)) {
      return yield* Effect.fail(parsed.failure);
    }
    const result = yield* services.browse.browse(parsed.success);
    return withApiCors(
      browseResponse(
        result,
        wantsJson(input.format, request.headers.accept ?? "")
      )
    );
  });

const handleConvert = (
  input: ConvertInput,
  request: HttpServerRequest.HttpServerRequest,
  services: HttpApplicationServices
): RoutedPayload =>
  Effect.gen(function* handleConvertEffect() {
    const accept = request.headers.accept ?? "";
    const userAgent = request.headers["user-agent"] ?? "";
    const requestedFormat = input.format ?? undefined;
    const asJson = wantsJson(requestedFormat, accept);
    const asMarkdown = wantsMarkdown(requestedFormat, accept);
    const noExplicitFormat = !requestedFormat && !asJson && !asMarkdown;
    const asEmbed = noExplicitFormat && isEmbedUserAgent(userAgent);
    const asHtml = noExplicitFormat && !asEmbed && acceptPrefersHtml(accept);

    const parsed = parseConvertRequest(input);
    if (Result.isFailure(parsed)) {
      return yield* Effect.fail(parsed.failure);
    }
    const result = yield* services.conversion.convert(parsed.success);
    return withApiCors(
      asEmbed
        ? embedResponse(result, { origin: originOf(request), userAgent })
        : markdownResponse(result, asJson, asHtml)
    );
  });

const handleOEmbed = (
  query: URLSearchParams,
  request: HttpServerRequest.HttpServerRequest
): HttpPayload => {
  const oembedQuery: OEmbedQuery = {
    author: param(query, "author"),
    provider: param(query, "provider"),
    status: param(query, "status"),
    text: param(query, "text"),
    url: param(query, "url"),
  };
  return withApiCors(oembedResponse(oembedQuery, originOf(request)));
};

const pathRoute = (
  path: string,
  query: URLSearchParams,
  request: HttpServerRequest.HttpServerRequest,
  services: HttpApplicationServices
): RoutedPayload | undefined => {
  if (path === "/" || path === "/docs") {
    return Effect.succeed(docsPayload());
  }
  if (path === "/api/browse") {
    return handleBrowse(browseInput(query), request, services);
  }
  if (path === "/api/convert") {
    return handleConvert(convertInput(query), request, services);
  }
  if (path === "/oembed") {
    return Effect.succeed(handleOEmbed(query, request));
  }
  if (path === "/search") {
    return handleBrowse(
      browseInput(query, { resource: "search" }),
      request,
      services
    );
  }
  return undefined;
};

const rewrittenRoute = (
  path: string,
  query: URLSearchParams,
  request: HttpServerRequest.HttpServerRequest,
  services: HttpApplicationServices
): RoutedPayload | undefined => {
  const statusMatch = STATUS_ROUTE.exec(path);
  if (statusMatch) {
    return handleConvert(
      convertInput(query, {
        handle: statusMatch[1] ?? "",
        id: statusMatch[2] ?? "",
      }),
      request,
      services
    );
  }

  const listMatch = LIST_ROUTE.exec(path);
  if (listMatch) {
    return handleBrowse(
      browseInput(query, {
        handle: listMatch[1] ?? "",
        resource: listMatch[2] ?? "",
      }),
      request,
      services
    );
  }

  const profileMatch = PROFILE_ROUTE.exec(path);
  if (profileMatch) {
    return handleBrowse(
      browseInput(query, {
        handle: profileMatch[1] ?? "",
        resource: "profile",
      }),
      request,
      services
    );
  }
  return undefined;
};

const routeRequest = (
  request: HttpServerRequest.HttpServerRequest,
  services: HttpApplicationServices
): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  if (request.method === "OPTIONS") {
    return Effect.succeed(
      HttpServerResponse.empty({ headers: API_CORS_HEADERS, status: 204 })
    );
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Effect.succeed(
      serverResponse(
        jsonErrorPayload(405, {
          code: "method_not_allowed",
          error: "Method not allowed",
        }),
        false
      )
    );
  }

  const url = new URL(request.originalUrl);
  const path = url.pathname.replace(/\/+$/u, "") || "/";
  const route =
    pathRoute(path, url.searchParams, request, services) ??
    rewrittenRoute(path, url.searchParams, request, services);
  if (!route) {
    return Effect.succeed(
      serverResponse(
        jsonErrorPayload(404, { code: "not_found", error: "Not found." }),
        request.method === "HEAD"
      )
    );
  }

  return route.pipe(
    Effect.match({ onFailure: failurePayload, onSuccess: (payload) => payload }),
    Effect.map((payload) => serverResponse(payload, request.method === "HEAD"))
  );
};

/**
 * Effect-native HTTP application boundary.
 *
 * Alchemy supplies the active {@link HttpServerRequest.HttpServerRequest} per
 * fetch event. Query/path values are parsed exactly once here before the parsed
 * request enters the application services.
 */
export const makeHttpApplication = (
  services: HttpApplicationServices
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
> =>
  HttpServerRequest.HttpServerRequest.pipe(
    Effect.flatMap((request) => routeRequest(request, services)),
    Effect.catchAllCause(() =>
      Effect.succeed(
        serverResponse(
          jsonErrorPayload(500, {
            code: "internal_error",
            error: "Internal server error",
          }),
          false
        )
      )
    )
  );
