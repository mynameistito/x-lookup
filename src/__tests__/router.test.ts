import { Effect, Layer } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { describe, expect, test } from "vitest";

import { Browse, layerBrowseWithoutDependencies } from "../lib/browse.js";
import { layerMemory } from "../lib/cache.js";
import {
  Conversion,
  layerConversionWithoutDependencies,
} from "../lib/converter.js";
import type { FxAuthor, FxTweet } from "../lib/fxtwitter.js";
import { FxTwitterSearchUnavailableError } from "../lib/provider-errors.js";
import { FxTwitter, Syndication } from "../lib/provider-service.js";
import type {
  FxTwitterService,
  SyndicationService,
} from "../lib/provider-service.js";
import { layerPostLookupWithoutDependencies } from "../lib/tweet-fetch.js";
import { makeHttpApplication } from "../router.js";
import type { HttpApplicationServices } from "../router.js";

interface ProviderCalls {
  readonly connections: Array<{
    readonly count: number | undefined;
    readonly handle: string;
    readonly relation: "followers" | "following";
  }>;
  readonly profiles: string[];
  readonly searches: Array<{
    readonly count: number | undefined;
    readonly query: string;
  }>;
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
      ? Effect.fail(new FxTwitterSearchUnavailableError({ operation: "search" }))
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

    expect(root.status).toBe(200);
    expect(root.headers.get("Content-Type")).toContain("text/markdown");
    expect(root.headers.get("Cache-Control")).toBe("public, max-age=3600");
    await expect(root.text()).resolves.toContain("# x-lookup");
    expect(docs.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(docs.text()).resolves.toContain("/api/convert");
    expect(calls.statuses).toStrictEqual([]);
    expect(calls.searches).toStrictEqual([]);
  });

  test("routes /api/convert and status aliases through the parsed application service", async () => {
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

    expect(api.status).toBe(200);
    expect(api.headers.get("Content-Type")).toContain("text/markdown");
    expect(api.headers.get("X-Source")).toBe("fxtwitter");
    expect(api.headers.get("X-Post-Count")).toBe("1");
    expect(api.headers.get("X-Warnings")).toBe("0");
    await expect(api.text()).resolves.toContain("hello world");
    expect(alias.status).toBe(200);
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
    expect(markdown.headers.get("Content-Type")).toContain("text/markdown");

    const jsonHarness = await makeHarness();
    const json = await runBoundary(
      request(`/api/convert?url=${target}&thread=off`, {
        headers: { Accept: "application/json" },
      }),
      jsonHarness.services
    );
    expect(json.headers.get("Content-Type")).toContain("application/json");
    await expect(json.json()).resolves.toMatchObject({
      postCount: 1,
      source: "fxtwitter",
    });

    const htmlHarness = await makeHarness();
    const html = await runBoundary(
      request(`/api/convert?url=${target}&thread=off`, {
        headers: { Accept: "text/html,application/xhtml+xml" },
      }),
      htmlHarness.services
    );
    expect(html.headers.get("Content-Type")).toContain("text/html");
    await expect(html.text()).resolves.toContain("<pre>");

    const embedHarness = await makeHarness();
    const embed = await runBoundary(
      request(`/api/convert?url=${target}&thread=off`, {
        headers: { "User-Agent": "Discordbot/2.0" },
      }),
      embedHarness.services
    );
    expect(embed.headers.get("Content-Type")).toContain("text/html");
    expect(embed.headers.get("X-Embed")).toBe("1");
    await expect(embed.text()).resolves.toContain('property="og:title"');
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

    expect(direct.status).toBe(200);
    expect(direct.headers.get("Content-Type")).toContain("application/json");
    expect(direct.headers.get("X-Browse-Resource")).toBe("profile");
    expect(search.headers.get("X-Result-Count")).toBe("1");
    await expect(search.text()).resolves.toContain("hello world");
    expect(calls.searches).toContainEqual({ count: 3, query: "cloudflare" });
    expect(calls.profiles).toContain("ada");
    expect(calls.connections).toContainEqual({
      count: 5,
      handle: "ada",
      relation: "followers",
    });
    expect(calls.connections).toContainEqual({
      count: 20,
      handle: "ada",
      relation: "following",
    });
  });

  test("serves oEmbed as a pure route with the historical response contract", async () => {
    const { calls, services } = await makeHarness();
    const statusUrl = encodeURIComponent("https://x.com/ada/status/123");

    const response = await runBoundary(
      request(`/oembed?url=${statusUrl}&text=Proof`),
      services
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toMatchObject({
      author_name: "Proof",
      author_url: "https://x.com/ada/status/123",
      provider_name: "x-lookup",
      type: "link",
      version: "1.0",
    });
    expect(calls.statuses).toStrictEqual([]);
  });

  test("handles OPTIONS, HEAD, 404, 405, and CORS at the boundary", async () => {
    const { services } = await makeHarness();

    const preflight = await runBoundary(
      request("/search", { method: "OPTIONS" }),
      services
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, HEAD, OPTIONS"
    );
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe(
      "Accept, Content-Type"
    );

    const head = await runBoundary(
      request("/search?q=x", { method: "HEAD" }),
      services
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("X-Result-Count")).toBe("1");
    await expect(head.text()).resolves.toBe("");

    const notFound = await runBoundary(request("/api/nope"), services);
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toMatchObject({ code: "not_found" });

    const method = await runBoundary(
      request("/search", { method: "POST" }),
      services
    );
    expect(method.status).toBe(405);
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

    expect(response.status).toBe(502);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toStrictEqual({
      code: "search_unavailable",
      error: "X search is unavailable upstream.",
    });
  });

  test("preserves cache/provider/result headers across misses and hits", async () => {
    const { calls, services } = await makeHarness();
    const target = encodeURIComponent("https://x.com/ada/status/777");
    const url = `/api/convert?url=${target}&thread=off`;

    const miss = await runBoundary(request(url), services);
    const hit = await runBoundary(request(url), services);

    expect(miss.headers.get("X-Cache")).toBe("MISS");
    expect(hit.headers.get("X-Cache")).toBe("HIT");
    expect(hit.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(hit.headers.get("X-Source")).toBe("fxtwitter");
    expect(hit.headers.get("X-Post-Count")).toBe("1");
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

    expect(response.status).toBe(status);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toStrictEqual({
      code,
      error: message,
    });
  });

  test("non-numeric status aliases remain unmatched 404s", async () => {
    const { services } = await makeHarness();
    const response = await runBoundary(request("/ada/status/abc"), services);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "not_found" });
  });
});
