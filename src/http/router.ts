import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  API_CORS_HEADERS,
  failurePayload,
  jsonErrorPayload,
  serverResponse,
} from "@/http/payloads.ts";
import { matchApplicationRoute } from "@/http/routes/application.ts";
import { matchStaticRoute } from "@/http/routes/static.ts";
import type { HttpApplicationServices } from "@/http/types.ts";

export type { HttpApplicationServices } from "@/http/types.ts";

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
  const staticRoute = matchStaticRoute(path, request);
  if (staticRoute) {
    return staticRoute;
  }
  const applicationRoute = matchApplicationRoute(
    path,
    url.searchParams,
    request,
    services
  );
  if (!applicationRoute) {
    return Effect.succeed(
      serverResponse(
        jsonErrorPayload(404, { code: "not_found", error: "Not found." }),
        request.method === "HEAD"
      )
    );
  }
  return applicationRoute.pipe(
    Effect.match({
      onFailure: failurePayload,
      onSuccess: (payload) => payload,
    }),
    Effect.map((payload) =>
      serverResponse(
        {
          ...payload,
          headers: {
            ...payload.headers,
            "X-Upstream-Budget": payload.status === 429 ? "refused" : "bounded",
          },
        },
        request.method === "HEAD"
      )
    )
  );
};

export const makeHttpApplication = (
  services: HttpApplicationServices
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest
> =>
  HttpServerRequest.HttpServerRequest.pipe(
    Effect.flatMap((request) => routeRequest(request, services)),
    Effect.catchCause(() =>
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
