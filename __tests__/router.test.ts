import { Effect, Layer } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { describe, expect, test } from "vitest";

import { Browse, layerBrowseWithoutDependencies } from "@/lib/browse.ts";
import { layerMemory } from "@/lib/cache.ts";
import {
  Conversion,
  layerConversionWithoutDependencies,
} from "@/lib/converter.ts";
import type { FxAuthor, FxTweet } from "@/lib/fxtwitter-types.ts";
import { FxTwitterSearchUnavailableError } from "@/lib/provider-errors.ts";
import { FxTwitter, Syndication } from "@/lib/provider-service.ts";
import type {
  FxTwitterService,
  SyndicationService,
} from "@/lib/provider-service.ts";
import { layerPostLookupWithoutDependencies } from "@/lib/tweet-fetch.ts";
import { makeHttpApplication } from "@/router.ts";
import type { HttpApplicationServices } from "@/router.ts";

interface ProviderCalls {
  readonly connections: {
    readonly count: number | undefined;
    readonly handle: string;
    readonly relation: "followers" | "following";
  }[];
  readonly profiles: string[];
  readonly searches: {
    readonly count: number | undefined;
    readonly query: string;
  }[];
  readonly statuses: string[];
  readonly threads: string[];
}

interface HarnessOptions {
  readonly failSearch?: boolean;
}

const author: FxAuthor = {
  description: "Computing pioneer",
  followers: 42,
  following: 7,
  name: "Ada",
  screen_name: "ada",
  statuses: 12,
};

const post = (id: string): FxTweet => ({
  author,
  context: "post",
  id,
  likes: 5,
  text: "hello world",
  url: `https://x.com/ada/status/${id}`,
});

const makeCalls = (): ProviderCalls => ({
  connections: [],
  profiles: [],
  searches: [],
  statuses: [],
  threads: [],
});

const makeFxTwitter = (
  calls: ProviderCalls,
  options: HarnessOptions
): FxTwitterService => ({
  fetchConnections: (handle, relation, _cursor, count) => {
    calls.connections.push({ count, handle, relation });
    return Effect.succeed({
      cursor: { bottom: "next" },
      results: [author],
    });
  },
  fetchConversationReplies: () => Effect.succeed([]),
  fetchFullThread: (id) => {
    calls.threads.push(id);
    return Effect.succeed([post(id)]);
  },
  fetchProfile: (handle) => {
    calls.profiles.push(handle);
    return Effect.succeed({ ...author, screen_name: handle });
  },
  fetchProfileStatuses: (handle) => {
    calls.profiles.push(`${handle}:statuses`);
    return Effect.succeed({
      cursor: { bottom: "next" },
      results: [post("201")],
    });
  },
  fetchStatus: (id) => {
    calls.statuses.push(id);
    return Effect.succeed(post(id));
  },
  searchStatuses: (query, _feed, _cursor, count) => {
    calls.searches.push({ count, query });
    return options.failSearch
      ? Effect.fail(
          new FxTwitterSearchUnavailableError({ operation: "search" })
        )
      : Effect.succeed({
          cursor: { bottom: "next" },
          results: [post("301")],
        });
  },
});

const makeSyndication = (): SyndicationService => ({
  fetchStatus: (_handle, id) => Effect.succeed(post(id)),
});

const testApplicationLayer = (
  calls: ProviderCalls,
  options: HarnessOptions
): Layer.Layer<Browse | Conversion> => {
  const cacheLayer = layerMemory();
  const fxLayer = Layer.succeed(
    FxTwitter,
    FxTwitter.of(makeFxTwitter(calls, options))
  );
  const syndicationLayer = Layer.succeed(
    Syndication,
    Syndication.of(makeSyndication())
  );
  const postLookupLayer = layerPostLookupWithoutDependencies.pipe(
    Layer.provide(Layer.mergeAll(fxLayer, syndicationLayer))
  );
  const browseLayer = layerBrowseWithoutDependencies.pipe(
    Layer.provide([cacheLayer, fxLayer])
  );
  const conversionLayer = layerConversionWithoutDependencies.pipe(
    Layer.provide([cacheLayer, postLookupLayer])
  );
  return Layer.mergeAll(browseLayer, conversionLayer);
};

const makeHarness = async (options: HarnessOptions = {}) => {
  const calls = makeCalls();
  const services = await Effect.runPromise(
    Effect.all({ browse: Browse, conversion: Conversion }).pipe(
      Effect.provide(testApplicationLayer(calls, options))
    )
  );
  return { calls, services };
};

const request = (path: string, init?: RequestInit): Request =>
  new Request(`http://localhost:8787${path}`, init);

const runBoundary = (
  webRequest: Request,
  services: HttpApplicationServices
): Promise<Response> =>
  Effect.runPromise(
    Effect.provideService(
      makeHttpApplication(services),
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(webRequest)
    ).pipe(Effect.map(HttpServerResponse.toWeb))
  );

describe("Effect HTTP boundary", () => {
  test("serves GET / and /docs without application provider calls", async () => {
    const { calls, services } = await makeHarness();
    const root = await runBoundary(request("/"), services);
    const docs = await runBoundary(request("/docs/"), services);
    const [rootBody, docsBody] = await Promise.all([root.text(), docs.text()]);

    expect({
      docsBody,
      docsCors: docs.headers.get("Access-Control-Allow-Origin"),
      rootBody,
      rootCacheControl: root.headers.get("Cache-Control"),
      rootContentType: root.headers.get("Content-Type"),
      rootStatus: root.status,
    }).toMatchObject({
      docsBody: expect.stringContaining("/api/convert"),
      docsCors: "*",
      rootBody: expect.stringContaining("# x-lookup"),
      rootCacheControl: "public, max-age=3600",
      rootContentType: expect.stringContaining("text/markdown"),
      rootStatus: 200,
    });
    expect({
      searches: calls.searches,
      statuses: calls.statuses,
    }).toStrictEqual({
      searches: [],
      statuses: [],
    });
  });

  test("serves Open Graph metadata for the browser root page", async () => {
    const { services } = await makeHarness();
    const response = await runBoundary(
      request("/", { headers: { Accept: "text/html" } }),
      services
    );
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(body).toContain("<title>x-lookup</title>");
    expect(body).toContain('property="og:title" content="x-lookup"');
    expect(body).toContain(
      'property="og:description" content="Read-only, no-auth browser for public X/Twitter content'
    );
    expect(body).toContain(
      'property="og:url" content="https://x-lookup.mynameistito.com/"'
    );
  });

  test("serves the root page as HTML to preview bots", async () => {
    const { services } = await makeHarness();
    const response = await runBoundary(
      request("/", { headers: { "User-Agent": "Discordbot/2.0" } }),
      services
    );

    expect(response.headers.get("Content-Type")).toContain("text/html");
    await expect(response.text()).resolves.toContain(
      '<meta property="og:title" content="x-lookup">'
    );
  });

  test("routes /api/convert and status aliases through parsed application input", async () => {
    const { calls, services } = await makeHarness();
    const target = encodeURIComponent("https://x.com/ada/status/123");
    const api = await runBoundary(
      request(`/api/convert?url=${target}&thread=off&format=markdown`),
      services
    );
    const alias = await runBoundary(
      request("/ada/status/456?thread=off"),
      services
    );
    const body = await api.text();

    expect({
      aliasStatus: alias.status,
      body,
      contentType: api.headers.get("Content-Type"),
      postCount: api.headers.get("X-Post-Count"),
      source: api.headers.get("X-Source"),
      status: api.status,
      warnings: api.headers.get("X-Warnings"),
    }).toMatchObject({
      aliasStatus: 200,
      body: expect.stringContaining("hello world"),
      contentType: expect.stringContaining("text/markdown"),
      postCount: "1",
      source: "fxtwitter",
      status: 200,
      warnings: "0",
    });
    expect(calls.statuses).toStrictEqual(["123", "456"]);
  });

  test("preserves Markdown, JSON, browser HTML, and preview-bot embed negotiation", async () => {
    const target = encodeURIComponent("https://x.com/ada/status/123");
    const markdownHarness = await makeHarness();
    const markdown = await runBoundary(
      request(`/api/convert?url=${target}&thread=off&format=markdown`, {
        headers: { Accept: "text/html" },
      }),
      markdownHarness.services
    );
    const jsonHarness = await makeHarness();
    const json = await runBoundary(
      request(`/api/convert?url=${target}&thread=off`, {
        headers: { Accept: "application/json" },
      }),
      jsonHarness.services
    );
    const htmlHarness = await makeHarness();
    const html = await runBoundary(
      request(`/api/convert?url=${target}&thread=off`, {
        headers: { Accept: "text/html,application/xhtml+xml" },
      }),
      htmlHarness.services
    );
    const embedHarness = await makeHarness();
    const embed = await runBoundary(
      request(`/api/convert?url=${target}&thread=off`, {
        headers: { "User-Agent": "Discordbot/2.0" },
      }),
      embedHarness.services
    );

    expect(markdown.headers.get("Content-Type")).toContain("text/markdown");
    await expect(json.json()).resolves.toMatchObject({
      postCount: 1,
      source: "fxtwitter",
    });
    await expect(html.text()).resolves.toContain("<pre>");
    expect({
      contentType: embed.headers.get("Content-Type"),
      embed: embed.headers.get("X-Embed"),
      html: await embed.text(),
    }).toMatchObject({
      contentType: expect.stringContaining("text/html"),
      embed: "1",
      html: expect.stringContaining('property="og:title"'),
    });
  });

  test("routes browse, search, profile, followers, and following aliases", async () => {
    const { calls, services } = await makeHarness();
    const direct = await runBoundary(
      request("/api/browse?resource=profile&handle=ada&format=json"),
      services
    );
    const search = await runBoundary(
      request("/search?q=cloudflare&limit=3"),
      services
    );
    await runBoundary(request("/ada"), services);
    await runBoundary(request("/ada/followers?limit=5"), services);
    await runBoundary(request("/ada/following"), services);

    expect({
      directContentType: direct.headers.get("Content-Type"),
      directResource: direct.headers.get("X-Browse-Resource"),
      directStatus: direct.status,
      searchBody: await search.text(),
      searchCount: search.headers.get("X-Result-Count"),
    }).toMatchObject({
      directContentType: expect.stringContaining("application/json"),
      directResource: "profile",
      directStatus: 200,
      searchBody: expect.stringContaining("hello world"),
      searchCount: "1",
    });
    expect(calls.searches).toContainEqual({ count: 3, query: "cloudflare" });
    expect(calls.connections).toStrictEqual(
      expect.arrayContaining([
        { count: 5, handle: "ada", relation: "followers" },
        { count: 20, handle: "ada", relation: "following" },
      ])
    );
    expect(calls.profiles).toContain("ada");
  });

  test("serves oEmbed as a pure route with the historical response contract", async () => {
    const { calls, services } = await makeHarness();
    const statusUrl = encodeURIComponent("https://x.com/ada/status/123");
    const response = await runBoundary(
      request(`/oembed?url=${statusUrl}&text=Proof`),
      services
    );

    expect({
      cacheControl: response.headers.get("Cache-Control"),
      cors: response.headers.get("Access-Control-Allow-Origin"),
      payload: await response.json(),
      status: response.status,
    }).toMatchObject({
      cacheControl: "public, max-age=3600",
      cors: "*",
      payload: {
        author_name: "Proof",
        author_url: "https://x.com/ada/status/123",
        provider_name: "x-lookup",
        type: "link",
        version: "1.0",
      },
      status: 200,
    });
    expect(calls.statuses).toStrictEqual([]);
  });

  test("handles OPTIONS, HEAD, 404, 405, and CORS at the boundary", async () => {
    const { services } = await makeHarness();
    const preflight = await runBoundary(
      request("/search", { method: "OPTIONS" }),
      services
    );
    const head = await runBoundary(
      request("/search?q=x", { method: "HEAD" }),
      services
    );
    const notFound = await runBoundary(request("/api/nope"), services);
    const method = await runBoundary(
      request("/search", { method: "POST" }),
      services
    );

    expect({
      allowHeaders: preflight.headers.get("Access-Control-Allow-Headers"),
      allowMethods: preflight.headers.get("Access-Control-Allow-Methods"),
      allowOrigin: preflight.headers.get("Access-Control-Allow-Origin"),
      status: preflight.status,
    }).toStrictEqual({
      allowHeaders: "Accept, Content-Type",
      allowMethods: "GET, HEAD, OPTIONS",
      allowOrigin: "*",
      status: 204,
    });
    expect({
      body: await head.text(),
      count: head.headers.get("X-Result-Count"),
      status: head.status,
    }).toStrictEqual({ body: "", count: "1", status: 200 });
    await expect(notFound.json()).resolves.toMatchObject({ code: "not_found" });
    await expect(method.json()).resolves.toMatchObject({
      code: "method_not_allowed",
    });
  });

  test("maps a typed provider failure to the existing JSON/status/code contract", async () => {
    const { services } = await makeHarness({ failSearch: true });
    const response = await runBoundary(
      request("/search?q=cloudflare"),
      services
    );

    expect({
      cors: response.headers.get("Access-Control-Allow-Origin"),
      payload: await response.json(),
      status: response.status,
    }).toStrictEqual({
      cors: "*",
      payload: {
        code: "search_unavailable",
        error: "X search is unavailable upstream.",
      },
      status: 502,
    });
  });

  test("preserves cache/provider/result headers across misses and hits", async () => {
    const { calls, services } = await makeHarness();
    const target = encodeURIComponent("https://x.com/ada/status/777");
    const url = `/api/convert?url=${target}&thread=off`;
    const miss = await runBoundary(request(url), services);
    const hit = await runBoundary(request(url), services);

    expect({
      cacheControl: hit.headers.get("Cache-Control"),
      hit: hit.headers.get("X-Cache"),
      miss: miss.headers.get("X-Cache"),
      postCount: hit.headers.get("X-Post-Count"),
      source: hit.headers.get("X-Source"),
    }).toStrictEqual({
      cacheControl: "public, max-age=0, must-revalidate",
      hit: "HIT",
      miss: "MISS",
      postCount: "1",
      source: "fxtwitter",
    });
    expect(calls.statuses).toStrictEqual(["777"]);
  });
});

describe("HTTP typed parse error mapping", () => {
  test.each([
    [
      "/api/convert?url=not%20a%20url",
      400,
      "invalid_url",
      "Invalid URL. Provide a public X/Twitter status URL.",
    ],
    [
      "/api/convert?url=https%3A%2F%2Fexample.com%2Fa%2Fstatus%2F1",
      400,
      "unsupported_host",
      "Only x.com or twitter.com status URLs are supported.",
    ],
    [
      "/api/convert?url=https%3A%2F%2Fx.com%2Fada",
      400,
      "invalid_path",
      "URL must be a status permalink like https://x.com/handle/status/1234567890.",
    ],
    [
      "/api/convert",
      400,
      "missing_url",
      "Missing required `url` query parameter.",
    ],
    [
      "/api/convert?handle=ada&id=abc",
      400,
      "invalid_params",
      "Missing or invalid handle/status id.",
    ],
    [
      "/api/convert?url=https%3A%2F%2Fx.com%2Fada%2Fstatus%2F1&format=rss",
      400,
      "invalid_format",
      "`format` must be `markdown`, `obsidian`, or `json`.",
    ],
    [
      "/api/convert?url=https%3A%2F%2Fx.com%2Fada%2Fstatus%2F1&thread=999",
      400,
      "invalid_thread",
      "`thread` must be `off`, `full`, `conversation`, or a number from 2 to 100.",
    ],
    [
      "/api/convert?url=https%3A%2F%2Fx.com%2Fada%2Fstatus%2F1&userinfo=both",
      400,
      "invalid_userinfo",
      "`userinfo` must be `off`, `author`, or `all`.",
    ],
    [
      "/api/convert?url=https%3A%2F%2Fx.com%2Fada%2Fstatus%2F1&context=bad",
      400,
      "invalid_context",
      "`context` must be `full` or `thread`.",
    ],
    [
      "/api/convert?url=https%3A%2F%2Fx.com%2Fada%2Fstatus%2F1&replies=bad",
      400,
      "invalid_replies",
      "`replies` must be `top`, `recent`, or `off`.",
    ],
    ["/api/browse", 400, "invalid_resource", "Unsupported browse resource."],
    [
      "/api/browse?resource=profile",
      400,
      "invalid_handle",
      "A valid X handle is required.",
    ],
    [
      "/api/browse?resource=search",
      400,
      "missing_query",
      "Search query q is required.",
    ],
    [
      "/api/browse?resource=search&q=x&format=obsidian",
      400,
      "invalid_format",
      "Browse `format` must be `markdown` or `json`.",
    ],
  ])("maps %s to %i %s", async (path, status, code, message) => {
    const { services } = await makeHarness();
    const response = await runBoundary(request(path), services);

    expect({
      cors: response.headers.get("Access-Control-Allow-Origin"),
      payload: await response.json(),
      status: response.status,
    }).toStrictEqual({
      cors: "*",
      payload: { code, error: message },
      status,
    });
  });

  test("non-numeric status aliases remain unmatched 404s", async () => {
    const { services } = await makeHarness();
    const response = await runBoundary(request("/ada/status/abc"), services);

    expect({
      payload: await response.json(),
      status: response.status,
    }).toMatchObject({
      payload: { code: "not_found" },
      status: 404,
    });
  });
});
