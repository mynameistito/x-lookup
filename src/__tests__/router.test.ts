import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

import { handleRequest } from "../router.js";

const respond = <T>(url: string, body: T, status = 200): Promise<Response> => {
  if (!url.includes("api.fxtwitter.com")) {
    return Promise.reject(new Error(`unexpected upstream: ${url}`));
  }
  return Promise.resolve(Response.json(body, { status }));
};

const stubFetch = (route: (url: string) => Promise<Response>): Mock => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(route);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const post = {
  author: { name: "Ada", screen_name: "ada" },
  id: "1",
  text: "hello world",
  url: "https://x.com/ada/status/1",
};

const stubFx = (): Mock =>
  stubFetch((url) => {
    if (url.includes("/2/search")) {
      return respond(url, { code: 200, results: [post] });
    }
    if (url.includes("/statuses")) {
      return respond(url, {
        code: 200,
        cursor: { bottom: "next" },
        results: [post],
      });
    }
    if (url.includes("/2/thread/") || url.includes("/2/conversation/")) {
      return respond(url, { code: 200, results: [], thread: [post] });
    }
    return respond(url, {
      code: 200,
      user: { name: "Ada", screen_name: "ada" },
    });
  });

const get = (path: string) => new Request(`http://localhost:8787${path}`);

describe("router routing", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test("routes /search to the search resource with the query", async () => {
    const fetchMock = stubFx();

    const response = await handleRequest(get("/search?q=cloudflare&limit=3"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    await expect(response.text()).resolves.toContain("hello world");
    const upstream = String(fetchMock.mock.calls[0]?.[0]);
    expect(upstream).toContain("q=cloudflare");
    expect(upstream).toContain("count=3");
  });

  test("routes profile, followers, and following handles", async () => {
    const fetchMock = stubFx();

    await handleRequest(get("/mynameistito"));
    await handleRequest(get("/mynameistito/followers?limit=5"));
    await handleRequest(get("/mynameistito/following"));

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      urls.some((url) => url.endsWith("/2/profile/mynameistito"))
    ).toBeTruthy();
    expect(
      urls.some((url) => url.includes("/2/profile/mynameistito/followers"))
    ).toBeTruthy();
    expect(urls.some((url) => url.includes("count=5"))).toBeTruthy();
    expect(
      urls.some((url) => url.includes("/2/profile/mynameistito/following"))
    ).toBeTruthy();
  });

  test("routes status rewrites to the converter with handle and id", async () => {
    const fetchMock = stubFx();

    const response = await handleRequest(get("/ada/status/123?thread=full"));

    expect(response.status).toBe(200);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/2/thread/123"))).toBeTruthy();
  });

  test("serves /api/browse directly", async () => {
    const fetchMock = stubFx();

    const response = await handleRequest(
      get("/api/browse?resource=profile&handle=ada")
    );

    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/2/profile/ada");
  });

  test("maps upstream search refusals to their status and JSON body", async () => {
    stubFetch((url) => respond(url, { code: 404, message: "NOT_FOUND" }));

    const response = await handleRequest(get("/search?q=cloudflare"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "search_unavailable",
      error: "X search is unavailable upstream.",
    });
  });

  test("returns 404 for unmatched paths including unknown api routes", async () => {
    const notFound = await handleRequest(get("/nope/extra"));
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toMatchObject({ code: "not_found" });

    const apiNotFound = await handleRequest(get("/api/nope"));
    expect(apiNotFound.status).toBe(404);
    await expect(apiNotFound.json()).resolves.toMatchObject({
      code: "not_found",
    });
  });

  test("returns 405 for non-GET methods and answers CORS preflights", async () => {
    const method = await handleRequest(
      new Request("http://localhost:8787/search", { method: "POST" })
    );
    expect(method.status).toBe(405);

    const preflight = await handleRequest(
      new Request("http://localhost:8787/search", { method: "OPTIONS" })
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("supports HEAD requests on API routes", async () => {
    stubFx();

    const response = await handleRequest(
      new Request("http://localhost:8787/search?q=x", { method: "HEAD" })
    );
    expect(response.status).toBe(200);
  });
});

describe("router documentation routes", () => {
  test("serves a markdown index at the root", async () => {
    const response = await handleRequest(get("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    await expect(response.text()).resolves.toContain("# x-lookup");
  });

  test("serves full usage docs at /docs", async () => {
    const response = await handleRequest(get("/docs"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.text()).resolves.toContain("/api/convert");
  });
});

describe("router typed-error mapping", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Every migrated parse refusal must keep its exact external contract:
   * truthful status, stable code, and the historical message.
   */
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
    const response = await handleRequest(get(path));
    expect(response.status).toBe(status);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toMatchObject({
      code,
      error: message,
    });
  });

  test("path status routes keep their 404 for non-numeric ids", async () => {
    const response = await handleRequest(get("/ada/status/abc"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "not_found" });
  });

  test("handle-only convert requests report the missing url", async () => {
    const response = await handleRequest(get("/api/convert?handle=ada"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "missing_url",
    });
  });
});
