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
});
