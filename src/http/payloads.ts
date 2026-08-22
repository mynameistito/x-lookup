import { HttpServerResponse } from "effect/unstable/http";
import type { HttpServerRequest } from "effect/unstable/http";

import type { HttpPayload } from "@/http/request.ts";
import { requestOrigin } from "@/http/request.ts";
import type { BoundaryFailure } from "@/http/types.ts";
import {
  agentSkillsHeaders,
  agentSkillsIndexContentType,
  agentSkillsIndexJson,
  agentSkillsMarkdownContentType,
  xLookupSkillMarkdown,
} from "@/metadata/agent-skills.ts";
import { ardCatalogJson, ARD_CONTENT_TYPE } from "@/metadata/ai-catalog.ts";
import {
  API_CATALOG_CONTENT_TYPE,
  API_CATALOG_LINK,
  apiCatalogJson,
  healthJson,
  openApiJson,
} from "@/metadata/api-catalog.ts";
import { ROOT_MARKDOWN, rootHtml } from "@/metadata/docs.ts";
import { robotsTxt } from "@/metadata/robots.ts";
import { sitemapXml } from "@/metadata/sitemap.ts";
import { webBotAuthDirectory } from "@/metadata/web-bot-auth.ts";

export const API_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

const CACHE_CONTROL = "public, max-age=3600";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export const originOf = (
  request: HttpServerRequest.HttpServerRequest
): string =>
  requestOrigin({
    headers: { host: request.headers.host },
    protocol: new URL(request.originalUrl).protocol,
  });

export const jsonErrorPayload = (
  status: number,
  body: { readonly code: string; readonly error: string }
): HttpPayload => ({
  body: JSON.stringify(body),
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": JSON_CONTENT_TYPE,
  },
  status,
});

export const withApiCors = (payload: HttpPayload): HttpPayload => ({
  ...payload,
  headers: { ...payload.headers, ...API_CORS_HEADERS },
});

export const serverResponse = (
  payload: HttpPayload,
  withoutBody: boolean
): HttpServerResponse.HttpServerResponse => {
  const options = { headers: payload.headers, status: payload.status };
  return withoutBody
    ? HttpServerResponse.empty(options)
    : HttpServerResponse.text(payload.body, options);
};

export const failurePayload = (failure: BoundaryFailure): HttpPayload =>
  jsonErrorPayload(failure.status, {
    code: failure.code,
    error: failure.message,
  });

const textPayload = (body: string, contentType: string): HttpPayload => ({
  body,
  headers: { "Cache-Control": CACHE_CONTROL, "Content-Type": contentType },
  status: 200,
});

export const docsPayload = (
  html: boolean,
  canonicalUrl: string
): HttpPayload => ({
  body: html ? rootHtml(canonicalUrl) : ROOT_MARKDOWN,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": html
      ? "text/html; charset=utf-8"
      : "text/markdown; charset=utf-8",
    Link: '</docs>; rel="service-doc"',
    Vary: "Accept",
  },
  status: 200,
});

export const robotsPayload = (origin: string): HttpPayload =>
  textPayload(robotsTxt(origin), "text/plain; charset=utf-8");
export const sitemapPayload = (origin: string): HttpPayload =>
  textPayload(sitemapXml(origin), "application/xml; charset=utf-8");
export const healthPayload = (): HttpPayload =>
  textPayload(healthJson(), JSON_CONTENT_TYPE);

export const webBotAuthPayload = (): HttpPayload => ({
  body: webBotAuthDirectory(),
  headers: {
    "Cache-Control": "public, max-age=86400, immutable",
    "Content-Type": "application/http-message-signatures-directory+json",
  },
  status: 200,
});

export const agentSkillsSkillPayload = (): HttpPayload => ({
  body: xLookupSkillMarkdown(),
  headers: agentSkillsHeaders(agentSkillsMarkdownContentType),
  status: 200,
});

export const apiCatalogPayload = (origin: string): HttpPayload => ({
  body: apiCatalogJson(origin),
  headers: {
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": API_CATALOG_CONTENT_TYPE,
    Link: API_CATALOG_LINK,
  },
  status: 200,
});

export const ardPayload = (origin: string): HttpPayload => ({
  body: ardCatalogJson(origin),
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": ARD_CONTENT_TYPE,
  },
  status: 200,
});

export const openApiPayload = (origin: string): HttpPayload =>
  textPayload(
    openApiJson(origin),
    "application/vnd.oai.openapi+json;version=3.1"
  );

export const agentSkillsIndexPayload = async (): Promise<HttpPayload> => ({
  body: await agentSkillsIndexJson(),
  headers: agentSkillsHeaders(agentSkillsIndexContentType),
  status: 200,
});
