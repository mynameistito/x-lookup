import { describe, expect, test } from "vitest";

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

const mcpRequest = (body: string): Request =>
  new Request("https://x-lookup.mynameistito.com/mcp", {
    body,
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Host: "x-lookup.mynameistito.com",
    },
    method: "POST",
  });

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
});
