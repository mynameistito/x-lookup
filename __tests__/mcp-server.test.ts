import { createMcpHandler } from "agents/mcp/server";
import { Effect } from "effect";
import { describe, expect, test } from "vitest";

import type { BrowseRequest, BrowseService } from "@/application/browse.ts";
import type {
  ConversionService,
  ConvertRequest,
} from "@/application/conversion.ts";
import { UpstreamWorkLimitError } from "@/infrastructure/upstream-work-budget.ts";
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

const listResourcesRequest = {
  id: 3,
  jsonrpc: "2.0",
  method: "resources/list",
  params: {},
};

const readResourceRequest = (id: number, uri: string): string =>
  JSON.stringify({
    id,
    jsonrpc: "2.0",
    method: "resources/read",
    params: { uri },
  });

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

const testExecutionContext = {};

describe("MCP boundary", () => {
  test("initializes and lists the OpenAPI-backed tools", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const initialized = await WorkerEntrypoint.fetch(
      mcpRequest(JSON.stringify(initializeRequest)),
      env,
      testExecutionContext
    );
    const listed = await WorkerEntrypoint.fetch(
      mcpRequest(JSON.stringify(listToolsRequest)),
      env,
      testExecutionContext
    );
    const initializedBody = await initialized.text();
    const listedBody = await listed.text();

    expect({
      initialized: initialized.status,
      listed: listed.status,
    }).toStrictEqual({ initialized: 200, listed: 200 });
    expect(initializedBody).toContain('"name":"x-lookup"');
    expect(listedBody).toMatch(
      /"name":"(?:browse_x|convert_status|get_conversation_context|get_health|get_oembed|get_profile|get_status|list_followers|list_following|search_posts)"/u
    );
    expect(listedBody).toMatch(
      /"(?:context|feed|format|full|limit|nocache|resource|thread|userinfo)"/u
    );
    expect(listedBody).toContain('"outputSchema"');
  });

  test("reads documentation resources without a session", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const resources = await WorkerEntrypoint.fetch(
      mcpRequest(JSON.stringify(listResourcesRequest)),
      env,
      testExecutionContext
    );
    const docs = await WorkerEntrypoint.fetch(
      mcpRequest(
        readResourceRequest(7, "https://x-lookup.mynameistito.com/docs")
      ),
      env,
      testExecutionContext
    );
    const resourcesBody = await resources.text();
    const openapi = await WorkerEntrypoint.fetch(
      mcpRequest(
        readResourceRequest(8, "https://x-lookup.mynameistito.com/openapi.json")
      ),
      env,
      testExecutionContext
    );

    expect({
      docs: docs.status,
      openapi: openapi.status,
      resources: resources.status,
      resourcesBody,
    }).toMatchObject({
      docs: 200,
      openapi: 200,
      resources: 200,
      resourcesBody: expect.stringMatching(
        /human_documentation.*openapi|openapi.*human_documentation/u
      ),
    });
    await expect(docs.text()).resolves.toContain("x-lookup");
    await expect(openapi.text()).resolves.toContain("openapi");
  });

  test("calls health and oEmbed tools through the Worker boundary", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const health = await WorkerEntrypoint.fetch(
      mcpRequest(toolCallRequest(3, "get_health", {})),
      env,
      testExecutionContext
    );
    const oembed = await WorkerEntrypoint.fetch(
      mcpRequest(
        toolCallRequest(4, "get_oembed", {
          text: "Example",
          url: "https://x.com/ada/status/123",
        })
      ),
      env,
      testExecutionContext
    );

    expect(health.status).toBe(200);
    const healthBody = await health.text();
    expect(oembed.status).toBe(200);
    const oembedBody = await oembed.text();
    expect({ healthBody, oembedBody }).toMatchObject({
      healthBody: expect.stringContaining(
        '{\\"check\\":\\"liveness\\",\\"status\\":\\"ok\\",\\"version\\":\\"1\\"}'
      ),
      oembedBody: expect.stringContaining('\\"provider_name\\":\\"x-lookup\\"'),
    });
    expect(`${healthBody}${oembedBody}`).toContain('"structuredContent"');
  });

  test("rejects missing operation-specific parameters", async () => {
    const env = { CACHE_TTL_SECONDS: "3600" };
    const search = await WorkerEntrypoint.fetch(
      mcpRequest(toolCallRequest(5, "search_posts", {})),
      env,
      testExecutionContext
    );
    const profile = await WorkerEntrypoint.fetch(
      mcpRequest(toolCallRequest(6, "get_profile", {})),
      env,
      testExecutionContext
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
      testExecutionContext
    );
    const unknown = await WorkerEntrypoint.fetch(
      mcpRequest(JSON.stringify(initializeRequest), "not-x-lookup.example.com"),
      env,
      testExecutionContext
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
      testExecutionContext
    );
    const malformedResponse = await WorkerEntrypoint.fetch(
      malformed,
      env,
      testExecutionContext
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
      handlerRequest("get_profile", { handle: "@ada", nocache: true }),
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
    const searchBody = await search.text();
    const conversionBody = await conversionResponse.text();
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
    expect({ conversionBody, searchBody }).toMatchObject({
      conversionBody: expect.stringContaining('"posts"'),
      searchBody: expect.stringContaining('"markdown"'),
    });
    expect(`${searchBody}${conversionBody}`).toMatch(
      /"structuredContent".*"cache".*"source"/u
    );
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
    expect(body).not.toContain('"structuredContent"');
  });

  test("returns upstream work refusal as a stable MCP tool error", async () => {
    const browse: BrowseService = {
      browse: () =>
        Effect.fail(
          new UpstreamWorkLimitError({
            limit: 3,
            operation: "browse",
            requested: 4,
          })
        ),
    };
    const conversion: ConversionService = {
      convert: () =>
        Effect.fail(
          new UpstreamWorkLimitError({
            limit: 3,
            operation: "convert",
            requested: 4,
          })
        ),
    };
    const handler = makeHandler(browse, conversion);
    const response = await handler(
      handlerRequest("search_posts", { q: "from:ada" }),
      {},
      testExecutionContext
    );

    await expect(response.text()).resolves.toContain(
      '\\"code\\":\\"upstream_work_limit\\"'
    );
  });
});
