import { Effect, Result } from "effect";
import type { HttpServerRequest } from "effect/unstable/http";

import { parseBrowseRequest } from "@/application/browse.ts";
import type { BrowseInput } from "@/application/browse.ts";
import { parseConvertRequest } from "@/application/conversion.ts";
import type { ConvertInput } from "@/application/conversion.ts";
import { docsPayload, originOf, withApiCors } from "@/http/payloads.ts";
import type { HttpPayload } from "@/http/request.ts";
import { acceptPrefersHtml, wantsJson, wantsMarkdown } from "@/http/request.ts";
import type { HttpApplicationServices, RoutedPayload } from "@/http/types.ts";
import { isEmbedUserAgent } from "@/presentation/embed.ts";
import type { OEmbedQuery } from "@/presentation/embed.ts";
import {
  browseResponse,
  embedResponse,
  markdownResponse,
  oembedResponse,
} from "@/presentation/http.ts";

const HANDLE = "([A-Za-z0-9_]{1,15})";
const STATUS_ROUTE = new RegExp(`^/${HANDLE}/status/(\\d+)$`, "u");
const LIST_ROUTE = new RegExp(`^/${HANDLE}/(followers|following)$`, "u");
const PROFILE_ROUTE = new RegExp(`^/${HANDLE}$`, "u");

const queryValue = (query: URLSearchParams, key: string): string | undefined =>
  query.get(key) ?? undefined;

const browseInput = (
  query: URLSearchParams,
  overrides: Partial<BrowseInput> = {}
): BrowseInput => ({
  cursor: queryValue(query, "cursor"),
  feed: queryValue(query, "feed"),
  format: queryValue(query, "format"),
  full: queryValue(query, "full"),
  handle: queryValue(query, "handle"),
  limit: queryValue(query, "limit"),
  nocache: queryValue(query, "nocache"),
  page: queryValue(query, "page"),
  q: queryValue(query, "q"),
  resource: queryValue(query, "resource"),
  ...overrides,
});

const convertInput = (
  query: URLSearchParams,
  overrides: Partial<ConvertInput> = {}
): ConvertInput => ({
  context: queryValue(query, "context"),
  format: queryValue(query, "format"),
  full: queryValue(query, "full"),
  handle: queryValue(query, "handle"),
  id: queryValue(query, "id"),
  nocache: queryValue(query, "nocache"),
  replies: queryValue(query, "replies"),
  thread: queryValue(query, "thread"),
  url: queryValue(query, "url"),
  userinfo: queryValue(query, "userinfo"),
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
        parsed.success,
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
    const format = input.format ?? undefined;
    const asJson = wantsJson(format, accept);
    const asMarkdown = wantsMarkdown(format, accept);
    const noExplicitFormat = !format && !asJson && !asMarkdown;
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
): HttpPayload =>
  withApiCors(
    oembedResponse(
      {
        author: queryValue(query, "author"),
        provider: queryValue(query, "provider"),
        status: queryValue(query, "status"),
        text: queryValue(query, "text"),
        url: queryValue(query, "url"),
      } satisfies OEmbedQuery,
      originOf(request)
    )
  );

export const matchApplicationRoute = (
  path: string,
  query: URLSearchParams,
  request: HttpServerRequest.HttpServerRequest,
  services: HttpApplicationServices
): RoutedPayload | undefined => {
  if (path === "/" || path === "/docs") {
    return Effect.succeed(
      docsPayload(
        acceptPrefersHtml(request.headers.accept ?? "") ||
          isEmbedUserAgent(request.headers["user-agent"] ?? ""),
        originOf(request) + (path === "/" ? "/" : "/docs")
      )
    );
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
