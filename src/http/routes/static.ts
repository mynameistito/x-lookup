import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type { HttpServerRequest } from "effect/unstable/http";

import {
  agentSkillsIndexPayload,
  agentSkillsSkillPayload,
  apiCatalogPayload,
  ardPayload,
  healthPayload,
  integrationsPayload,
  llmsTxtPayload,
  mcpServerCardPayload,
  openApiPayload,
  originOf,
  robotsPayload,
  serverResponse,
  sitemapPayload,
  webBotAuthPayload,
} from "@/http/payloads.ts";
import type { HttpPayload } from "@/http/request.ts";
import { renderOpenGraphImage } from "@/presentation/opengraph.ts";

const staticResponse = (
  request: HttpServerRequest.HttpServerRequest,
  payload: HttpPayload
): HttpServerResponse.HttpServerResponse =>
  serverResponse(payload, request.method === "HEAD");

export const matchStaticRoute = (
  path: string,
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<HttpServerResponse.HttpServerResponse> | undefined => {
  const origin = originOf(request);
  if (path === "/robots.txt") {
    return Effect.succeed(staticResponse(request, robotsPayload(origin)));
  }
  if (path === "/sitemap.xml") {
    return Effect.succeed(staticResponse(request, sitemapPayload(origin)));
  }
  if (path === "/.well-known/http-message-signatures-directory") {
    return Effect.succeed(staticResponse(request, webBotAuthPayload()));
  }
  if (path === "/.well-known/api-catalog") {
    return Effect.succeed(staticResponse(request, apiCatalogPayload(origin)));
  }
  if (path === "/.well-known/ai-catalog.json") {
    return Effect.succeed(staticResponse(request, ardPayload(origin)));
  }
  if (path === "/.well-known/integrations.json") {
    return Effect.succeed(staticResponse(request, integrationsPayload(origin)));
  }
  if (path === "/.well-known/mcp/server-card.json") {
    return Effect.succeed(
      staticResponse(request, mcpServerCardPayload(origin))
    );
  }
  if (path === "/.well-known/agent-skills/x-lookup/SKILL.md") {
    return Effect.succeed(staticResponse(request, agentSkillsSkillPayload()));
  }
  if (path === "/.well-known/agent-skills/index.json") {
    return Effect.promise(async () =>
      staticResponse(request, await agentSkillsIndexPayload())
    );
  }
  if (path === "/openapi.json") {
    return Effect.succeed(staticResponse(request, openApiPayload(origin)));
  }
  if (path === "/llms.txt") {
    return Effect.succeed(staticResponse(request, llmsTxtPayload(origin)));
  }
  if (path === "/health") {
    return Effect.succeed(staticResponse(request, healthPayload()));
  }
  if (path !== "/og.png") {
    return undefined;
  }
  const headers = {
    "Cache-Control": "public, max-age=86400, immutable",
    "Content-Type": "image/png",
  };
  return Effect.promise(() => renderOpenGraphImage()).pipe(
    Effect.map((image) =>
      request.method === "HEAD"
        ? HttpServerResponse.empty({ headers, status: 200 })
        : HttpServerResponse.uint8Array(image, { headers, status: 200 })
    )
  );
};
