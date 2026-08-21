import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock(import('../lib/cache.js'), () => ({
  buildCacheKey: vi.fn(() => "browse-test"),
  cacheControlHeader: vi.fn(() => "public, max-age=300"),
  memoryConfig: vi.fn(() => ({ stores: [], ttlSeconds: 300 })),
  withCache: vi.fn(
    async (_key: string, _nocache: boolean, fn: () => Promise<unknown>) => ({
      status: "miss",
      value: await fn(),
    })
  ),
}));

vi.mock(import('../lib/fxtwitter.js'), () => ({
  fetchFxConnections: vi.fn(),
  fetchFxProfile: vi.fn(),
  fetchFxProfileStatuses: vi.fn(),
  searchFxStatuses: vi.fn(),
}));

import { browse, browseResponse, isOriginalPost } from "../lib/browse.js";
import { buildCacheKey } from "../lib/cache.js";
import { ConvertError } from "../lib/errors.js";
import {
  fetchFxConnections,
  fetchFxProfile,
  fetchFxProfileStatuses,
  searchFxStatuses,
} from "../lib/fxtwitter.js";

const post = {
  author: { screen_name: "ada" },
  id: "1",
  text: "hello",
  url: "https://x.com/ada/status/1",
};

beforeEach(() => vi.clearAllMocks());

describe(browse, () => {
  test("filters replies and reposts from a profile and includes source links", async () => {
    vi.mocked(fetchFxProfile).mockResolvedValue({
      name: "Ada",
      screen_name: "ada",
    });
    vi.mocked(fetchFxProfileStatuses).mockResolvedValue({
      cursor: { bottom: "next" },
      results: [
        post,
        { ...post, id: "2", replying_to: ["bob"] },
        { ...post, id: "3", reposted_by: "bob" },
      ],
    });
    const result = await browse({
      handle: "ada",
      nocache: true,
      resource: "profile",
    });
    expect(result.posts).toHaveLength(1);
    expect(result.markdown).toContain("[@ada](https://x.com/ada)");
    expect(result.markdown).toContain("[Source](https://x.com/ada/status/1)");
    expect(result.markdown).toContain("/ada?cursor=next");
    expect(result.markdown).toContain("/ada?page=2");
  });

  test("walks cursors sequentially for page=N", async () => {
    vi.mocked(searchFxStatuses)
      .mockResolvedValueOnce({ cursor: { bottom: "page-2" }, results: [] })
      .mockResolvedValueOnce({ cursor: { bottom: "page-3" }, results: [post] });
    const result = await browse({
      nocache: true,
      page: 2,
      q: "hello world",
      resource: "search",
    });
    expect(searchFxStatuses).toHaveBeenNthCalledWith(
      2,
      "hello world",
      "latest",
      "page-2",
      20
    );
    expect(result.markdown).toContain(
      "/search?q=hello+world&feed=latest&cursor=page-3"
    );
    expect(result.markdown).toContain(
      "/search?q=hello+world&feed=latest&page=3"
    );
  });

  test.each([
    { expected: false, full: "false" },
    { expected: true, full: "true" },
  ])(
    "parses full=$full when building both continuation links",
    async ({ full, expected }) => {
      vi.mocked(searchFxStatuses).mockResolvedValue({
        cursor: { bottom: "next" },
        results: [post],
      });
      const result = await browse({
        full,
        limit: 7,
        nocache: true,
        page: 3,
        q: "x-lookup",
        resource: "search",
      });
      expect(result.markdown.includes("full=true")).toBe(expected);
      expect(result.markdown).toContain("limit=7");
      expect(result.markdown).toContain("cursor=next");
      expect(result.markdown).toContain("page=4");
    }
  );

  test("dispatches following and caps the local limit", async () => {
    vi.mocked(fetchFxConnections).mockResolvedValue({
      results: [{ screen_name: "bob" }],
    });
    const result = await browse({
      handle: "ada",
      limit: 999,
      nocache: true,
      resource: "following",
    });
    expect(fetchFxConnections).toHaveBeenCalledWith(
      "ada",
      "following",
      undefined,
      50
    );
    expect(result.users?.[0]?.screen_name).toBe("bob");
  });

  test("propagates upstream search refusals as search_unavailable", async () => {
    vi.mocked(searchFxStatuses).mockRejectedValue(
      new ConvertError(
        502,
        "X search is unavailable upstream.",
        "search_unavailable"
      )
    );
    await expect(
      browse({ nocache: true, q: "cloudflare", resource: "search" })
    ).rejects.toMatchObject({ code: "search_unavailable", status: 502 });
  });

  test("produces structured JSON with response metadata", async () => {
    vi.mocked(searchFxStatuses).mockResolvedValue({ results: [post] });
    const result = await browse({
      full: true,
      nocache: true,
      q: "x-lookup",
      resource: "search",
    });
    const response = browseResponse(result, true);
    expect(response.headers["Content-Type"]).toContain("application/json");
    expect(response.headers).toMatchObject({
      "Cache-Control": "public, max-age=300",
      Vary: "Accept",
    });
    expect(response.headers["X-Source"]).toBe("fxtwitter");
    expect(response.headers["X-Result-Count"]).toBe("1");
    expect(JSON.parse(response.body)).toMatchObject({
      query: "x-lookup",
      resource: "search",
    });
    expect(result.markdown).toContain("0 likes");
  });

  test("rejects Obsidian output on browse resources", async () => {
    await expect(
      browse({ format: "obsidian", handle: "ada", resource: "profile" })
    ).rejects.toBeInstanceOf(ConvertError);
  });

  test("includes output format in the cache identity", async () => {
    vi.mocked(searchFxStatuses).mockResolvedValue({ results: [post] });
    await browse({ format: "json", q: "x-lookup", resource: "search" });
    expect(vi.mocked(buildCacheKey)).toHaveBeenCalledWith(
      expect.objectContaining({ format: "json", v: 2 })
    );
  });
});

test("provider filtering identifies replies and reposts", () => {
  expect(isOriginalPost(post)).toBeTruthy();
  expect(isOriginalPost({ ...post, replying_to_status: ["9"] })).toBeFalsy();
  expect(isOriginalPost({ ...post, reposted_by: { screen_name: "bob" } })).toBeFalsy();
});
