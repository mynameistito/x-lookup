const absoluteUrl = (origin: string, path: string): string =>
  new URL(path, origin).toString();

export const integrationsJson = (origin: string): string => {
  const source = absoluteUrl(origin, "/.well-known/integrations.json");

  return JSON.stringify({
    summary:
      "Read-only, no-auth access to public X/Twitter statuses, profiles, search, followers, and following for AI agents.",
    surfaces: [
      {
        auth: { basis: { source, via: "declared" }, status: "none" },
        basis: { source, via: "declared" },
        docs: absoluteUrl(origin, "/docs"),
        name: "x-lookup HTTP API",
        slug: "x-lookup-api",
        spec: absoluteUrl(origin, "/openapi.json"),
        type: "http",
        url: origin,
      },
      {
        auth: { basis: { source, via: "declared" }, status: "none" },
        basis: { source, via: "declared" },
        docs: absoluteUrl(origin, "/docs"),
        name: "x-lookup MCP server",
        slug: "x-lookup-mcp",
        transports: ["streamable-http"],
        type: "mcp",
        url: absoluteUrl(origin, "/mcp"),
      },
    ],
    version: 3,
  });
};

export const llmsTxt = (origin: string): string => `# x-lookup

x-lookup is a read-only, no-auth browser for public X/Twitter content, built for AI agents. It returns compact Markdown by default and structured JSON on request. It can read public statuses and threads, profiles, search results, followers, and following. Private, deleted, and gated content is unavailable.

## Documentation

- [Usage documentation](${absoluteUrl(origin, "/docs")})
- [OpenAPI 3.1 document](${absoluteUrl(origin, "/openapi.json")})
- [MCP server](${absoluteUrl(origin, "/mcp")})
- [Agent skill](${absoluteUrl(origin, "/.well-known/agent-skills/x-lookup/SKILL.md")})

No login, API key, or X credentials are required. The service uses the free FxTwitter API and Twitter syndication endpoint for public content.
`;

export const mcpServerCardJson = (origin: string): string =>
  JSON.stringify({ url: absoluteUrl(origin, "/mcp") });
