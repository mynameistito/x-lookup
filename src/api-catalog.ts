export interface LinkTarget {
  readonly href: string;
  readonly type?: string;
}

export interface ApiCatalogEntry {
  readonly anchor: string;
  readonly "service-desc": readonly LinkTarget[];
  readonly "service-doc": readonly LinkTarget[];
  readonly status: readonly LinkTarget[];
}

export interface ApiCatalog {
  readonly linkset: readonly ApiCatalogEntry[];
}

export const API_CATALOG_PROFILE = "https://www.rfc-editor.org/info/rfc9727";
export const API_CATALOG_CONTENT_TYPE = `application/linkset+json; profile="${API_CATALOG_PROFILE}"`;
export const API_CATALOG_LINK = '</.well-known/api-catalog>; rel="api-catalog"';

const absoluteUrl = (origin: string, path: string): string =>
  new URL(path, origin).toString();

export const apiCatalog = (origin: string): ApiCatalog => ({
  linkset: [
    {
      anchor: absoluteUrl(origin, "/api/convert"),
      "service-desc": [
        {
          href: absoluteUrl(origin, "/openapi.json"),
          type: "application/vnd.oai.openapi+json;version=3.1",
        },
      ],
      "service-doc": [
        { href: absoluteUrl(origin, "/docs"), type: "text/html" },
      ],
      status: [
        { href: absoluteUrl(origin, "/health"), type: "application/json" },
      ],
    },
  ],
});

export const apiCatalogJson = (origin: string): string =>
  JSON.stringify(apiCatalog(origin));

export const openApiDocument = (origin: string) => ({
  info: {
    description:
      "Read-only access to public X/Twitter statuses, profiles, search, and social graphs.",
    title: "x-lookup API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths: {
    "/api/browse": {
      get: {
        description: "Browse a public profile, search results, or connections.",
        operationId: "browseX",
        parameters: [
          {
            in: "query",
            name: "resource",
            required: true,
            schema: {
              enum: ["profile", "search", "followers", "following"],
            },
          },
          {
            in: "query",
            name: "handle",
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "q",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Browse results." },
          "400": { description: "Invalid request." },
          "502": { description: "Upstream provider failure." },
        },
      },
    },
    "/api/convert": {
      get: {
        description: "Convert a public X/Twitter status or thread.",
        operationId: "convertStatus",
        parameters: [
          {
            in: "query",
            name: "url",
            required: false,
            schema: { format: "uri", type: "string" },
          },
          {
            in: "query",
            name: "handle",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "id",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "format",
            schema: { enum: ["markdown", "obsidian", "json"] },
          },
        ],
        responses: {
          "200": { description: "Converted status or thread." },
          "400": { description: "Invalid request." },
          "404": { description: "Status not found." },
          "502": { description: "Upstream provider failure." },
        },
      },
    },
  },
  servers: [{ url: origin }],
});

export const openApiJson = (origin: string): string =>
  JSON.stringify(openApiDocument(origin));

export const healthJson = (): string => JSON.stringify({ status: "ok" });
