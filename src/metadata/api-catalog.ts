import { apiContract } from "@/domain/api-contract.ts";
import type { ApiParameter } from "@/domain/api-contract.ts";

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

interface OpenApiSchema {
  readonly $ref?: string;
  readonly default?: boolean | number | string;
  readonly enum?: readonly string[];
  readonly format?: string;
  readonly items?: OpenApiSchema;
  readonly maximum?: number;
  readonly minimum?: number;
  readonly minLength?: number;
  readonly pattern?: string;
  readonly type?: string;
}

const queryParameter = (
  name: string,
  schema: OpenApiSchema,
  description: string,
  required = false
) => ({ description, in: "query", name, required, schema });

const pathParameter = (name: string, description: string) => ({
  description,
  in: "path",
  name,
  required: true,
  schema: { pattern: "^[A-Za-z0-9_]{1,15}$", type: "string" },
});

const handlePathParameter = pathParameter("handle", "X profile handle.");

const errorResponse = {
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
  description: "The request could not be completed.",
};

const authorRef = { $ref: "#/components/schemas/Author" };
const postRef = { $ref: "#/components/schemas/Post" };
type HttpDefault = string | number | boolean | undefined;

const httpDefault = (parameter: ApiParameter): HttpDefault => {
  if (parameter.default === true) {
    return "true";
  }
  if (parameter.default === false) {
    return "false";
  }
  return parameter.default;
};

const contractSchema = (parameter: ApiParameter): OpenApiSchema => ({
  default: httpDefault(parameter),
  enum: parameter.httpValues ?? parameter.values,
  format: parameter.format,
  maximum: parameter.maximum,
  minLength: parameter.minLength,
  minimum: parameter.minimum,
  pattern: parameter.pattern,
  type: parameter.httpType,
});

const contractParameters = (operation: keyof typeof apiContract) =>
  apiContract[operation].map((parameter: ApiParameter) =>
    queryParameter(
      parameter.name,
      contractSchema(parameter),
      parameter.description,
      parameter.required
    )
  );

const browseParameters = contractParameters("browse");
const convertParameters = contractParameters("conversion");
const browseAliasExcluded = new Set(["resource", "handle", "q", "feed"]);

const browseAliasParameters = () =>
  browseParameters.filter(
    (parameter) => !browseAliasExcluded.has(parameter.name)
  );

const browseResponse = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/BrowseResponse" },
    },
    "text/markdown": { schema: { type: "string" } },
  },
  description: "Browse results in the requested representation.",
};

const convertResponse = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ConvertResponse" },
    },
    "text/html": { schema: { type: "string" } },
    "text/markdown": { schema: { type: "string" } },
  },
  description: "Converted status or thread in the requested representation.",
};

const browseOperation = (
  parameters: readonly unknown[],
  operationId = "browseX"
) => ({
  description: "Browse a public profile, search results, or connections.",
  operationId,
  parameters,
  responses: {
    "200": browseResponse,
    "400": errorResponse,
    "502": errorResponse,
  },
});

const convertOperation = (
  parameters: readonly unknown[],
  operationId = "convertStatus"
) => ({
  description: "Convert a public X/Twitter status or thread.",
  operationId,
  parameters,
  responses: {
    "200": convertResponse,
    "400": errorResponse,
    "404": errorResponse,
    "502": errorResponse,
  },
});

export const openApiDocument = (origin: string) => ({
  components: {
    schemas: {
      Author: {
        additionalProperties: true,
        description: "Public author fields returned by the upstream provider.",
        properties: {
          description: { type: "string" },
          followers: { type: "integer" },
          following: { type: "integer" },
          id: { type: "string" },
          name: { type: "string" },
          screen_name: { type: "string" },
          url: { format: "uri", type: "string" },
        },
        type: "object",
      },
      BrowseResponse: {
        additionalProperties: true,
        description: "Structured browse response returned when format=json.",
        properties: {
          cache: { enum: ["hit", "miss", "bypass"], type: "string" },
          feed: { enum: ["latest", "media", "top"], type: "string" },
          handle: { type: "string" },
          limit: { type: "integer" },
          nextCursor: { type: "string" },
          page: { type: "integer" },
          posts: { items: postRef, type: "array" },
          profile: authorRef,
          query: { type: "string" },
          resource: {
            enum: ["profile", "search", "followers", "following"],
            type: "string",
          },
          users: { items: authorRef, type: "array" },
        },
        type: "object",
      },
      ConvertResponse: {
        description:
          "Structured conversion response returned when format=json.",
        properties: {
          cache: { enum: ["hit", "miss", "bypass"], type: "string" },
          compact: { type: "boolean" },
          format: { enum: ["markdown", "obsidian", "json"], type: "string" },
          markdown: { type: "string" },
          postCount: { type: "integer" },
          posts: { items: postRef, type: "array" },
          source: { type: "string" },
          url: { format: "uri", type: "string" },
          warnings: { items: { type: "string" }, type: "array" },
        },
        required: [
          "cache",
          "compact",
          "format",
          "markdown",
          "postCount",
          "posts",
          "source",
          "url",
          "warnings",
        ],
        type: "object",
      },
      Error: {
        properties: {
          code: { type: "string" },
          error: { type: "string" },
        },
        required: ["error", "code"],
        type: "object",
      },
      HealthResponse: {
        properties: { status: { const: "ok", type: "string" } },
        required: ["status"],
        type: "object",
      },
      Post: {
        additionalProperties: true,
        description: "Public post fields returned by the upstream provider.",
        properties: {
          author: { $ref: "#/components/schemas/Author" },
          context: {
            enum: ["parent", "post", "thread", "reply"],
            type: "string",
          },
          created_at: { type: "string" },
          id: { type: "string" },
          likes: { type: "integer" },
          text: { type: "string" },
          url: { format: "uri", type: "string" },
        },
        type: "object",
      },
    },
  },
  externalDocs: {
    description: "Human-readable API documentation.",
    url: absoluteUrl(origin, "/docs"),
  },
  info: {
    contact: { url: "https://github.com/mynameistito/x-lookup" },
    description:
      "Read-only access to public X/Twitter statuses, profiles, search, and social graphs. Query parameters are strings on the wire; integer parameters are normalized and clamped as described.",
    license: { name: "MIT", url: "https://opensource.org/license/mit" },
    title: "x-lookup API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths: {
    "/api/browse": { get: browseOperation(browseParameters) },
    "/api/convert": { get: convertOperation(convertParameters) },
    "/health": {
      get: {
        description: "Return the service health status.",
        operationId: "getHealth",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
            description: "The service is healthy.",
          },
        },
      },
    },
    "/oembed": {
      get: {
        description: "Render an oEmbed response for an X status URL.",
        operationId: "getOEmbed",
        parameters: [
          queryParameter(
            "url",
            { format: "uri", type: "string" },
            "Status URL to embed."
          ),
          queryParameter(
            "text",
            { type: "string" },
            "Optional title/text override."
          ),
          queryParameter(
            "author",
            { type: "string" },
            "Optional author name override."
          ),
          queryParameter(
            "status",
            { type: "string" },
            "Optional status text override."
          ),
          queryParameter(
            "provider",
            { type: "string" },
            "Optional provider name override."
          ),
        ],
        responses: {
          "200": {
            content: { "application/json": { schema: { type: "object" } } },
            description: "oEmbed response.",
          },
        },
      },
    },
    "/search": {
      get: browseOperation(
        browseParameters
          .filter(
            (parameter) =>
              parameter.name !== "resource" && parameter.name !== "handle"
          )
          .map((parameter) =>
            parameter.name === "q"
              ? { ...parameter, required: true }
              : parameter
          ),
        "searchPosts"
      ),
    },
    "/{handle}": {
      get: browseOperation(
        [handlePathParameter, ...browseAliasParameters()],
        "getProfile"
      ),
    },
    "/{handle}/followers": {
      get: browseOperation(
        [handlePathParameter, ...browseAliasParameters()],
        "listFollowers"
      ),
    },
    "/{handle}/following": {
      get: browseOperation(
        [handlePathParameter, ...browseAliasParameters()],
        "listFollowing"
      ),
    },
    "/{handle}/status/{id}": {
      get: convertOperation(
        [
          pathParameter("handle", "Status author handle."),
          {
            description: "Numeric X status ID.",
            in: "path",
            name: "id",
            required: true,
            schema: { pattern: "^\\d+$", type: "string" },
          },
          ...convertParameters.filter(
            (parameter) => !["url", "handle", "id"].includes(parameter.name)
          ),
        ],
        "convertStatusPath"
      ),
    },
  },
  servers: [{ url: origin }],
});

export const openApiJson = (origin: string): string =>
  JSON.stringify(openApiDocument(origin));

export const healthJson = (): string => JSON.stringify({ status: "ok" });
