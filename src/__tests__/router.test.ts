import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(import("../lib/browse.js"), () => ({
  browse: vi.fn(),
  browseResponse: vi.fn(),
}));

vi.mock(import("../lib/converter.js"), () => {
  class TestConvertError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ConvertError: TestConvertError,
    acceptPrefersHtml: vi.fn(() => false),
    convertTweet: vi.fn(),
    markdownResponse: vi.fn(),
  };
});

vi.mock(import("../lib/embed.js"), () => ({
  embedResponse: vi.fn(),
  isEmbedUserAgent: vi.fn(() => false),
  oembedResponse: vi.fn(),
}));

import { browse, browseResponse } from "../lib/browse.js";
import { ConvertError, convertTweet } from "../lib/converter.js";
import { handleRequest } from "../router.js";

const markdown = {
  body: "# md\n",
  headers: { "Content-Type": "text/markdown; charset=utf-8" },
  status: 200,
};

const get = (path: string) => new Request(`http://localhost:8787${path}`);

beforeEach(() => vi.clearAllMocks());

describe("router routing", () => {
  test("routes /search to the search resource with the query", async () => {
    vi.mocked(browse).mockResolvedValue({ resource: "search" } as never);
    vi.mocked(browseResponse).mockReturnValue(markdown);

    const response = await handleRequest(get("/search?q=cloudflare&limit=3"));

    expect(browse).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: "3",
        q: "cloudflare",
        resource: "search",
      }),
      expect.anything()
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("# md\n");
  });

  test("routes profile, followers, and following handles", async () => {
    vi.mocked(browse).mockResolvedValue({ resource: "profile" } as never);
    vi.mocked(browseResponse).mockReturnValue(markdown);

    await handleRequest(get("/mynameistito"));
    await handleRequest(get("/mynameistito/followers?limit=5"));
    await handleRequest(get("/mynameistito/following"));

    expect(vi.mocked(browse).mock.calls[0]?.[0]).toMatchObject({
      handle: "mynameistito",
      resource: "profile",
    });
    expect(vi.mocked(browse).mock.calls[1]?.[0]).toMatchObject({
      handle: "mynameistito",
      limit: "5",
      resource: "followers",
    });
    expect(vi.mocked(browse).mock.calls[2]?.[0]).toMatchObject({
      handle: "mynameistito",
      resource: "following",
    });
  });

  test("routes status rewrites to the converter with handle and id", async () => {
    vi.mocked(convertTweet).mockResolvedValue({ source: "fxtwitter" } as never);
    vi.mocked(
      (await import("../lib/converter.js")).markdownResponse
    ).mockReturnValue(markdown);

    const response = await handleRequest(get("/ada/status/123?thread=full"));

    expect(convertTweet).toHaveBeenCalledWith(
      expect.objectContaining({ handle: "ada", id: "123", thread: "full" }),
      expect.anything()
    );
    expect(response.status).toBe(200);
  });

  test("serves /api/browse directly", async () => {
    vi.mocked(browse).mockResolvedValue({ resource: "profile" } as never);
    vi.mocked(browseResponse).mockReturnValue(markdown);

    await handleRequest(get("/api/browse?resource=profile&handle=ada"));

    expect(browse).toHaveBeenCalledWith(
      expect.objectContaining({ handle: "ada", resource: "profile" }),
      expect.anything()
    );
  });

  test("maps ConvertError to its status and JSON body", async () => {
    vi.mocked(browse).mockRejectedValue(
      new ConvertError(
        502,
        "X search is unavailable upstream.",
        "search_unavailable"
      )
    );

    const response = await handleRequest(get("/search?q=cloudflare"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toStrictEqual({
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
    vi.mocked(browse).mockResolvedValue({ resource: "search" } as never);
    vi.mocked(browseResponse).mockReturnValue(markdown);

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
