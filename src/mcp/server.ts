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
import { DEFAULT_ORIGIN } from "@/http/request.ts";
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
const handle = z
  .string()
  .regex(/^[A-Za-z0-9_]{1,15}$/u)
  .describe("X handle, without the @ prefix.");
const cursor = z
  .string()
  .describe("Opaque continuation cursor returned by a previous response.")
  .optional();
const page = z
  .number()
  .int()
  .min(1)
  .max(10)
  .default(1)
  .describe("Page to fetch when no cursor is supplied.");
const limit = z
  .number()
  .int()
  .min(1)
  .max(50)
  .default(20)
  .describe("Maximum number of results to return.");
const full = z
  .boolean()
  .default(false)
  .describe("Include richer post metrics and user details.");
const nocache = z
  .boolean()
  .default(false)
  .describe("Bypass the application cache.");
const browseFormat = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Response representation.");
const feed = z
  .enum(["latest", "media", "top"])
  .default("latest")
  .describe("Search result ordering.");

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
  resource: z
    .enum(["profile", "search", "followers", "following"])
    .describe("Browse resource to query."),
};

const searchInputSchema = {
  ...browseCommonInputSchema,
  feed,
  q: z
    .string()
    .min(1)
    .describe("Search query, including X operators such as from: or since:.")
    .trim(),
};

const profileInputSchema = {
  ...browseCommonInputSchema,
  handle,
};

const convertInputSchema = {
  context: z
    .enum(["full", "thread"])
    .default("full")
    .describe("Conversation context to include."),
  format: z
    .enum(["markdown", "obsidian", "json"])
    .default("markdown")
    .describe("Response representation."),
  full,
  handle: handle.optional(),
  id: z.string().regex(/^\d+$/u).describe("Numeric X status ID.").optional(),
  nocache,
  replies: z
    .enum(["top", "recent", "off"])
    .default("top")
    .describe("Replies to include around the focal post."),
  thread: z
    .union([
      z.enum(["off", "full", "conversation"]),
      z.string().regex(/^(?:[2-9]|[1-9]\d|100)$/u),
    ])
    .default("full")
    .describe("Thread selection: off, full, conversation, or 2-100."),
  url: z.string().url().describe("Public X or Twitter status URL.").optional(),
  userinfo: z
    .enum(["off", "author", "all"])
    .default("off")
    .describe("Author information to include."),
};

const oembedInputSchema = {
  author: optionalString,
  provider: optionalString,
  status: optionalString,
  text: optionalString,
  url: z.string().url().describe("Status URL to embed.").optional(),
};

type BrowseToolInput = z.infer<z.ZodObject<typeof browseInputSchema>>;
type ConvertToolInput = z.infer<z.ZodObject<typeof convertInputSchema>>;
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

const jsonResult = (body: string) => ({
  content: [{ text: body, type: "text" as const }],
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
    onSuccess: (result) =>
      jsonResult(browseResponse(parsed.success, result, true).body),
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
    onSuccess: (result) => jsonResult(markdownResponse(result, true).body),
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
    { description, inputSchema },
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
    title: "mynameistito MCP",
    version: "1.0.0",
  });

  server.registerTool(
    "convert_status",
    {
      description:
        "Convert a public X/Twitter status or thread to structured JSON and Markdown.",
      inputSchema: convertInputSchema,
    },
    (input) => runConvert(services.conversion, convertInput(input))
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
    },
    (input: OEmbedToolInput) =>
      Promise.resolve(jsonResult(oembedResponse(input, DEFAULT_ORIGIN).body))
  );

  server.registerTool(
    "get_health",
    {
      description: "Return the x-lookup service health status.",
      inputSchema: {},
    },
    () => Promise.resolve(jsonResult(JSON.stringify({ status: "ok" })))
  );

  return server;
};
