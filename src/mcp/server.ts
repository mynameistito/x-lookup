import { McpServer } from "@modelcontextprotocol/server";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { z } from "zod";

import { parseBrowseRequest } from "@/application/browse.ts";
import type { BrowseInput, BrowseService } from "@/application/browse.ts";
import { parseConvertRequest } from "@/application/conversion.ts";
import type {
  ConvertInput,
  ConversionService,
} from "@/application/conversion.ts";
import { apiContract } from "@/domain/api-contract.ts";
import type { ApiParameter } from "@/domain/api-contract.ts";
import { DEFAULT_ORIGIN } from "@/http/request.ts";
import { healthJson, openApiJson } from "@/metadata/api-catalog.ts";
import { ROOT_MARKDOWN } from "@/metadata/docs.ts";
import {
  browseResponse,
  markdownResponse,
  oembedResponse,
} from "@/presentation/http.ts";

export interface McpApplicationServices {
  readonly browse: BrowseService;
  readonly conversion: ConversionService;
}

const optionalString = z.string().optional();
const parameter = (
  operation: keyof typeof apiContract,
  name: string
): ApiParameter => {
  const found = apiContract[operation].find((item) => item.name === name);
  if (!found) {
    throw new Error(`Missing API contract parameter: ${operation}.${name}`);
  }
  return found;
};

const stringParameter = (operation: keyof typeof apiContract, name: string) => {
  const item = parameter(operation, name);
  if (item.values && name !== "thread") {
    const schema = z.enum(item.values);
    if (item.default === undefined) {
      return schema.describe(item.description);
    }
    return schema.default(String(item.default)).describe(item.description);
  }
  let schema = z.string();
  if (item.pattern) {
    schema = schema.regex(new RegExp(item.pattern, "u"));
  }
  if (item.minLength) {
    schema = schema.min(item.minLength);
  }
  if (item.default === undefined) {
    return schema.describe(item.description);
  }
  return schema.default(String(item.default)).describe(item.description);
};

const booleanParameter = (operation: keyof typeof apiContract, name: string) =>
  z
    .boolean()
    .default(parameter(operation, name).default === true)
    .describe(parameter(operation, name).description);

const handle = stringParameter("profile", "handle");
const cursor = stringParameter("profile", "cursor").optional();
const searchQuery = z
  .string()
  .min(parameter("search", "q").minLength ?? 1)
  .describe(parameter("search", "q").description)
  .trim();
const page = z
  .number()
  .int()
  .min(parameter("profile", "page").minimum ?? 1)
  .max(parameter("profile", "page").maximum ?? 10)
  .default(Number(parameter("profile", "page").default))
  .describe(parameter("profile", "page").description);
const limit = z
  .number()
  .int()
  .min(parameter("profile", "limit").minimum ?? 1)
  .max(parameter("profile", "limit").maximum ?? 50)
  .default(Number(parameter("profile", "limit").default))
  .describe(parameter("profile", "limit").description);
const full = booleanParameter("profile", "full");
const nocache = booleanParameter("profile", "nocache");
const browseFormat = stringParameter("profile", "format");
const feed = stringParameter("search", "feed");

const browseCommonInputSchema = {
  cursor,
  format: browseFormat,
  full,
  limit,
  nocache,
  page,
};

const browseInputSchema = {
  ...browseCommonInputSchema,
  feed,
  handle: handle.optional(),
  q: optionalString,
  resource: stringParameter("browse", "resource"),
};

const searchInputSchema = {
  ...browseCommonInputSchema,
  feed,
  q: searchQuery,
};

const profileInputSchema = {
  ...browseCommonInputSchema,
  handle,
};

const convertInputSchema = {
  context: stringParameter("conversion", "context"),
  format: stringParameter("conversion", "format"),
  full,
  handle: handle.optional(),
  id: stringParameter("conversion", "id").optional(),
  nocache,
  replies: stringParameter("conversion", "replies"),
  thread: stringParameter("conversion", "thread"),
  url: z
    .string()
    .url()
    .describe(parameter("conversion", "url").description)
    .optional(),
  userinfo: stringParameter("conversion", "userinfo"),
};

const conversationInputSchema = {
  format: stringParameter("conversion", "format"),
  full,
  handle: handle.optional(),
  id: stringParameter("conversion", "id").optional(),
  nocache,
  url: z
    .string()
    .url()
    .describe(parameter("conversion", "url").description)
    .optional(),
  userinfo: stringParameter("conversion", "userinfo"),
};

const oembedInputSchema = {
  author: optionalString,
  provider: optionalString,
  status: optionalString,
  text: optionalString,
  url: z.string().url().describe("Status URL to embed.").optional(),
};

const authorSchema = z
  .object({
    avatar_url: z.string().optional(),
    banner_url: z.string().optional(),
    description: z.string().optional(),
    followers: z.number().optional(),
    following: z.number().optional(),
    id: z.string().optional(),
    joined: z.string().optional(),
    likes: z.number().optional(),
    location: z.string().optional(),
    media_count: z.number().optional(),
    name: z.string().optional(),
    protected: z.boolean().optional(),
    screen_name: z.string().optional(),
    statuses: z.number().optional(),
    url: z.string().optional(),
    verification: z
      .object({ type: z.string().optional(), verified: z.boolean().optional() })
      .optional(),
    website: z
      .object({
        display_url: z.string().optional(),
        url: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const tweetSchema = z
  .object({
    article: z.record(z.string(), z.unknown()).optional(),
    author: authorSchema.optional(),
    bookmarks: z.number().optional(),
    community_note: z.unknown().optional(),
    context: z.enum(["parent", "post", "thread", "reply"]).optional(),
    created_at: z.string().optional(),
    created_timestamp: z.number().optional(),
    id: z.string().optional(),
    lang: z.string().optional(),
    likes: z.number().optional(),
    media: z.record(z.string(), z.unknown()).optional(),
    poll: z.record(z.string(), z.unknown()).optional(),
    possibly_sensitive: z.boolean().optional(),
    quote: z.record(z.string(), z.unknown()).optional(),
    quotes: z.number().optional(),
    replies: z.number().optional(),
    replying_to: z
      .union([z.array(z.string()), z.record(z.string(), z.unknown()), z.null()])
      .optional(),
    replying_to_status: z.array(z.string()).nullable().optional(),
    reposted_by: authorSchema.nullable().optional(),
    reposts: z.number().optional(),
    retweets: z.number().optional(),
    source: z.string().optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    views: z.number().nullable().optional(),
  })
  .passthrough();

const browseOutputSchema = z
  .object({
    cache: z.enum(["hit", "miss", "bypass"]),
    feed: z.string().optional(),
    handle: z.string().optional(),
    limit: z.number(),
    markdown: z.string(),
    nextCursor: z.string().optional(),
    page: z.number(),
    posts: z.array(tweetSchema).optional(),
    profile: authorSchema.optional(),
    query: z.string().optional(),
    resource: z.enum(["profile", "search", "followers", "following"]),
    users: z.array(authorSchema).optional(),
  })
  .passthrough();

const conversionOutputSchema = z.object({
  cache: z.enum(["hit", "miss", "bypass"]),
  compact: z.boolean(),
  format: z.enum(["markdown", "obsidian", "json"]),
  markdown: z.string(),
  postCount: z.number(),
  posts: z.array(tweetSchema),
  source: z.string(),
  url: z.string(),
  warnings: z.array(z.string()),
});

const oembedOutputSchema = z.object({
  author_name: z.string(),
  author_url: z.string(),
  provider_name: z.string(),
  provider_url: z.string(),
  title: z.string(),
  type: z.string(),
  version: z.string(),
});

const healthOutputSchema = z.object({ status: z.literal("ok") });

type BrowseToolInput = z.infer<z.ZodObject<typeof browseInputSchema>>;
type ConvertToolInput = z.infer<z.ZodObject<typeof convertInputSchema>>;
type ConversationToolInput = z.infer<
  z.ZodObject<typeof conversationInputSchema>
>;
type OEmbedToolInput = z.infer<z.ZodObject<typeof oembedInputSchema>>;
interface ToolFailure {
  readonly code: string;
  readonly message: string;
}

const browseInput = (
  input: BrowseToolInput,
  resource?: string
): BrowseInput => ({ ...input, resource: resource ?? input.resource });

const convertInput = (input: ConvertToolInput): ConvertInput => input;

const conversationInput = (input: ConversationToolInput): ConvertInput => ({
  ...input,
  context: "full",
  replies: "top",
  thread: "conversation",
});

const browseAliasInput = (
  input: BrowseToolInput,
  resource: string
): BrowseInput => ({ ...input, resource });

const errorResult = ({ code, message }: ToolFailure) => ({
  content: [
    { text: JSON.stringify({ code, error: message }), type: "text" as const },
  ],
  isError: true,
});

const internalErrorResult = () => ({
  content: [
    {
      text: JSON.stringify({
        code: "internal_error",
        error: "Internal server error",
      }),
      type: "text" as const,
    },
  ],
  isError: true,
});

const jsonResult = <StructuredContent>(
  body: string,
  structuredContent: StructuredContent
) => ({
  content: [{ text: body, type: "text" as const }],
  structuredContent,
});

const causeResult = <Failure extends ToolFailure>(
  cause: Cause.Cause<Failure>
) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: internalErrorResult,
    onSome: errorResult,
  });

type ToolResult =
  | ReturnType<typeof errorResult>
  | ReturnType<typeof jsonResult>;

const runBrowse = async (
  service: BrowseService,
  input: BrowseInput
): Promise<ToolResult> => {
  const parsed = parseBrowseRequest(input);
  if (Result.isFailure(parsed)) {
    return errorResult(parsed.failure);
  }
  const exit = await Effect.runPromiseExit(service.browse(parsed.success));
  return Exit.match(exit, {
    onFailure: causeResult,
    onSuccess: (result) => {
      const { body } = browseResponse(parsed.success, result, true);
      return jsonResult(body, JSON.parse(body));
    },
  });
};

const runConvert = async (
  service: ConversionService,
  input: ConvertInput
): Promise<ToolResult> => {
  const parsed = parseConvertRequest(input);
  if (Result.isFailure(parsed)) {
    return errorResult(parsed.failure);
  }
  const exit = await Effect.runPromiseExit(service.convert(parsed.success));
  return Exit.match(exit, {
    onFailure: causeResult,
    onSuccess: (result) => {
      const { body } = markdownResponse(result, true);
      return jsonResult(body, JSON.parse(body));
    },
  });
};

const browseTool = (
  server: McpServer,
  services: McpApplicationServices,
  name: string,
  description: string,
  resource: string | undefined,
  inputSchema:
    | typeof browseInputSchema
    | typeof searchInputSchema
    | typeof profileInputSchema
) => {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      outputSchema: browseOutputSchema,
    },
    (input: BrowseToolInput) =>
      runBrowse(
        services.browse,
        resource
          ? browseAliasInput(input, resource)
          : browseInput(input, resource)
      )
  );
};

/** Create the stateless MCP server exposing the OpenAPI application operations. */
export const createMcpServer = (
  services: McpApplicationServices
): McpServer => {
  const server = new McpServer({
    name: "x-lookup",
    version: "1.0.0",
  });

  server.registerTool(
    "convert_status",
    {
      description:
        "Convert a public X/Twitter status or thread to structured JSON and Markdown.",
      inputSchema: convertInputSchema,
      outputSchema: conversionOutputSchema,
    },
    (input) => runConvert(services.conversion, convertInput(input))
  );

  server.registerTool(
    "get_status",
    {
      description:
        "Convert a public X/Twitter status. Use convert_status when you need explicit thread or conversation controls.",
      inputSchema: convertInputSchema,
      outputSchema: conversionOutputSchema,
    },
    (input) => runConvert(services.conversion, convertInput(input))
  );

  server.registerTool(
    "get_conversation_context",
    {
      description:
        "Convert a public X/Twitter status with its parent context, author thread, and top replies.",
      inputSchema: conversationInputSchema,
      outputSchema: conversionOutputSchema,
    },
    (input) => runConvert(services.conversion, conversationInput(input))
  );

  browseTool(
    server,
    services,
    "browse_x",
    "Browse a public X profile, search results, followers, or following users.",
    undefined,
    browseInputSchema
  );
  browseTool(
    server,
    services,
    "search_posts",
    "Search public X posts using an X search query.",
    "search",
    searchInputSchema
  );
  browseTool(
    server,
    services,
    "get_profile",
    "Get a public X profile and its latest original posts.",
    "profile",
    profileInputSchema
  );
  browseTool(
    server,
    services,
    "list_followers",
    "List public followers for an X profile.",
    "followers",
    profileInputSchema
  );
  browseTool(
    server,
    services,
    "list_following",
    "List public accounts followed by an X profile.",
    "following",
    profileInputSchema
  );

  server.registerTool(
    "get_oembed",
    {
      description: "Render an oEmbed response for an X status URL.",
      inputSchema: oembedInputSchema,
      outputSchema: oembedOutputSchema,
    },
    (input: OEmbedToolInput) => {
      const { body } = oembedResponse(input, DEFAULT_ORIGIN);
      return Promise.resolve(jsonResult(body, JSON.parse(body)));
    }
  );

  server.registerTool(
    "get_health",
    {
      description:
        "Return static x-lookup liveness status. This does not verify upstream providers or cache availability.",
      inputSchema: {},
      outputSchema: healthOutputSchema,
    },
    () => {
      const body = healthJson();
      return Promise.resolve(jsonResult(body, JSON.parse(body)));
    }
  );

  server.registerResource(
    "human_documentation",
    new URL("/docs", DEFAULT_ORIGIN).toString(),
    {
      description: "Human-readable x-lookup API documentation.",
      mimeType: "text/markdown",
      title: "x-lookup API documentation",
    },
    (uri) =>
      Promise.resolve({
        contents: [
          { mimeType: "text/markdown", text: ROOT_MARKDOWN, uri: uri.href },
        ],
      })
  );

  server.registerResource(
    "openapi",
    new URL("/openapi.json", DEFAULT_ORIGIN).toString(),
    {
      description: "OpenAPI 3.1 description of the x-lookup HTTP API.",
      mimeType: "application/json",
      title: "x-lookup OpenAPI document",
    },
    (uri) =>
      Promise.resolve({
        contents: [
          {
            mimeType: "application/json",
            text: openApiJson(DEFAULT_ORIGIN),
            uri: uri.href,
          },
        ],
      })
  );

  return server;
};
