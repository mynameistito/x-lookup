import { createMcpHandler } from "agents/mcp/server";
import { Effect } from "effect";
import { describe, expect, test } from "vitest";

import type { BrowseRequest, BrowseService } from "@/application/browse.ts";
import type {
  ConversionService,
  ConvertRequest,
} from "@/application/conversion.ts";
import { createMcpServer } from "@/mcp/server.ts";
import { FxTwitterSearchUnavailableError } from "@/providers/errors/fxtwitter-search.ts";
import WorkerEntrypoint from "@/worker.ts";

const initializeRequest = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: { name: "x-lookup-test", version: "1.0.0" },
    protocolVersion: "2025-11-25",
  },
};

const listToolsRequest = {
  id: 2,
  jsonrpc: "2.0",
  method: "tools/list",
  params: {},
};

const toolCallRequest = (
  id: number,
  name: string,
  args: Record<string, string>
): string =>
  JSON.stringify({
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: args, name },
  });

const mcpRequest = (
  body: string,
  hostname = "x-lookup.mynameistito.com"
): Request =>
  new Request(`https://${hostname}/mcp`, {
    body,
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Host: hostname,
    },
    method: "POST",
  });

const handlerRequest = (
  name: string,
  args: Record<string, string | number | boolean>
): Request =>
  new Request("https://x-lookup.mynameistito.com/mcp", {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name },
    }),
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Host: "x-lookup.mynameistito.com",
    },
    method: "POST",
  });

const makeHandler = (browse: BrowseService, conversion: ConversionService) =>
  createMcpHandler(() => createMcpServer({ browse, conversion }), {
    allowedHostnames: ["x-lookup.mynameistito.com"],
    allowedOriginHostnames: "*",
    responseMode: "json",
  });

// SAFETY: The stateless MCP handler does not use execution-context methods in these adapter tests.
const testExecutionContext = {} as ExecutionContext;

describe("MCP boundary", () => {
  test("initializes and lists the OpenAPI-backed tools", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const initialized = await WorkerEntrypoint.fetch(
      mcpRequest(JSON.stringify(initializeRequest)),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );
    const listed = await WorkerEntrypoint.fetch(
      mcpRequest(JSON.stringify(listToolsRequest)),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );
    const initializedBody = await initialized.text();
    const listedBody = await listed.text();

    expect(initialized.status).toBe(200);
    expect(listed.status).toBe(200);
    expect(initializedBody).toContain('"name":"x-lookup"');
    expect(listedBody).toMatch(
      /"name":"(?:browse_x|convert_status|get_health|get_oembed|get_profile|list_followers|list_following|search_posts)"/u
    );
    expect(listedBody).toMatch(
      /"(?:context|feed|format|full|limit|nocache|resource|thread|userinfo)"/u
    );
  });

  test("calls health and oEmbed tools through the Worker boundary", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const health = await WorkerEntrypoint.fetch(
      mcpRequest(toolCallRequest(3, "get_health", {})),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );
    const oembed = await WorkerEntrypoint.fetch(
      mcpRequest(
        toolCallRequest(4, "get_oembed", {
          text: "Example",
          url: "https://x.com/ada/status/123",
        })
      ),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );

    expect(health.status).toBe(200);
    await expect(health.text()).resolves.toContain('{\\"status\\":\\"ok\\"}');
    expect(oembed.status).toBe(200);
    await expect(oembed.text()).resolves.toContain(
      '\\"provider_name\\":\\"x-lookup\\"'
    );
  });

  test("rejects missing operation-specific parameters", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const search = await WorkerEntrypoint.fetch(
      mcpRequest(toolCallRequest(5, "search_posts", {})),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );
    const profile = await WorkerEntrypoint.fetch(
      mcpRequest(toolCallRequest(6, "get_profile", {})),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );

    expect(search.status).toBe(200);
    await expect(search.text()).resolves.toContain("Invalid input");
    expect(profile.status).toBe(200);
    await expect(profile.text()).resolves.toContain("Invalid input");
  });

  test("allows isolated Workers preview hostnames but rejects unknown hosts", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const preview = await WorkerEntrypoint.fetch(
      mcpRequest(
        JSON.stringify(initializeRequest),
        "x-lookup-pr-7.preview.workers.dev"
      ),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );
    const unknown = await WorkerEntrypoint.fetch(
      mcpRequest(JSON.stringify(initializeRequest), "not-x-lookup.example.com"),
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );

    expect(preview.status).toBe(200);
    expect(unknown.status).toBe(403);
  });

  test("supports valid browser origins and rejects malformed origins", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const browser = mcpRequest(JSON.stringify(initializeRequest));
    browser.headers.set("Origin", "https://playground.ai.cloudflare.com");
    const malformed = mcpRequest(JSON.stringify(initializeRequest));
    malformed.headers.set("Origin", "not-an-origin");

    const browserResponse = await WorkerEntrypoint.fetch(
      browser,
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );
    const malformedResponse = await WorkerEntrypoint.fetch(
      malformed,
      env,
      // SAFETY: The MCP handler does not use execution-context methods in this protocol test.
      {} as ExecutionContext
    );

    expect(browserResponse.status).toBe(200);
    expect(browserResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      "*"
    );
    expect(malformedResponse.status).toBe(403);
  });

  test("routes tool aliases and preserves parsed operation options", async () => {
    const browseInputs: BrowseRequest[] = [];
    const conversionInputs: ConvertRequest[] = [];
    const browse: BrowseService = {
      browse: (input) => {
        browseInputs.push(input);
        return Effect.succeed({
          cache: "miss" as const,
          limit: input.limit,
          page: input.page,
          query:
            input.selection._tag === "search"
              ? input.selection.query
              : undefined,
          resource: input.selection._tag,
        });
      },
    };
    const conversion: ConversionService = {
      convert: (input) => {
        conversionInputs.push(input);
        return Effect.succeed({
          cache: "miss" as const,
          canonicalUrl: "https://x.com/ada/status/123",
          compact: input.compact,
          format: input.format,
          postCount: 0,
          posts: [],
          source: "fxtwitter" as const,
          userinfo: input.userinfo,
          warnings: [],
        });
      },
    };
    const handler = makeHandler(browse, conversion);

    const search = await handler(
      handlerRequest("search_posts", {
        feed: "top",
        full: true,
        limit: 7,
        page: 2,
        q: "  from:ada release  ",
      }),
      {},
      testExecutionContext
    );
    const profile = await handler(
      handlerRequest("get_profile", { handle: "ada", nocache: true }),
      {},
      testExecutionContext
    );
    const conversionResponse = await handler(
      handlerRequest("convert_status", {
        context: "thread",
        format: "json",
        full: true,
        replies: "off",
        thread: "10",
        url: "https://x.com/ada/status/123",
      }),
      {},
      testExecutionContext
    );

    expect([
      search.status,
      profile.status,
      conversionResponse.status,
    ]).toStrictEqual([200, 200, 200]);
    expect(browseInputs).toMatchObject([
      {
        full: true,
        limit: 7,
        page: 2,
        selection: { _tag: "search", feed: "top", query: "from:ada release" },
      },
      { nocache: true, selection: { _tag: "profile", handle: "ada" } },
    ]);
    expect(conversionInputs[0]).toMatchObject({
      context: "thread",
      format: "json",
      replies: "off",
      thread: { _tag: "full", limit: 10 },
    });
  });

  test("returns typed provider failures as MCP tool errors", async () => {
    const browse: BrowseService = {
      browse: () =>
        Effect.fail(
          new FxTwitterSearchUnavailableError({ operation: "search" })
        ),
    };
    const conversion: ConversionService = {
      convert: () =>
        Effect.succeed({
          cache: "miss" as const,
          canonicalUrl: "https://x.com/ada/status/123",
          compact: true,
          format: "markdown" as const,
          postCount: 0,
          posts: [],
          source: "fxtwitter" as const,
          userinfo: "off" as const,
          warnings: [],
        }),
    };
    const handler = makeHandler(browse, conversion);
    const response = await handler(
      handlerRequest("search_posts", { q: "from:ada" }),
      {},
      testExecutionContext
    );

    const body = await response.text();
    expect({ body, status: response.status }).toMatchObject({
      body: expect.stringContaining('"isError":true'),
      status: 200,
    });
    expect(body).toContain('\\"code\\":\\"search_unavailable\\"');
  });
});
