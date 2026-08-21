import { Result } from "effect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

import { browse, browseResponse, isOriginalPost } from "../lib/browse.js";

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

/** Unwrap a browse result, failing the test when it is a typed failure. */
const succeed = async (input: Parameters<typeof browse>[0]) => {
  const result = await browse(input);
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

/** Extract the typed failure of a browse call, failing the test on success. */
const failureOf = async (input: Parameters<typeof browse>[0]) => {
  const result = await browse(input);
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

const post = {
  author: { screen_name: "ada" },
  id: "1",
  text: "hello",
  url: "https://x.com/ada/status/1",
};

describe(browse, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("filters replies and reposts from a profile and includes source links", async () => {
    stubFetch((url) => {
      if (url.includes("/statuses")) {
        return respond(url, {
          code: 200,
          cursor: { bottom: "next" },
          results: [
            post,
            { ...post, id: "2", replying_to: ["bob"] },
            { ...post, id: "3", reposted_by: "bob" },
          ],
        });
      }
      return respond(url, {
        code: 200,
        user: { name: "Ada", screen_name: "ada" },
      });
    });

    const result = await succeed({
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
    const fetchMock = stubFetch((url) => {
      if (url.includes("cursor=page-2")) {
        return respond(url, {
          code: 200,
          cursor: { bottom: "page-3" },
          results: [post],
        });
      }
      return respond(url, {
        code: 200,
        cursor: { bottom: "page-2" },
        results: [],
      });
    });

    const result = await succeed({
      nocache: true,
      page: 2,
      q: "hello world",
      resource: "search",
    });

    const secondCall = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondCall).toContain("cursor=page-2");
    expect(secondCall).toContain("count=20");
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
      stubFetch((url) =>
        respond(url, {
          code: 200,
          cursor: { bottom: "next" },
          results: [post],
        })
      );
      const result = await succeed({
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
    const fetchMock = stubFetch((url) =>
      respond(url, {
        code: 200,
        results: [{ name: "Bob", screen_name: "bob" }],
      })
    );

    const result = await succeed({
      handle: "ada",
      limit: 999,
      nocache: true,
      resource: "following",
    });

    const firstCall = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstCall).toContain("/2/profile/ada/following");
    expect(firstCall).toContain("count=50");
    expect(result.users?.[0]?.screen_name).toBe("bob");
  });

  test("propagates upstream search refusals as search_unavailable", async () => {
    stubFetch((url) => respond(url, { code: 404, message: "NOT_FOUND" }));

    const failure = await failureOf({
      nocache: true,
      q: "cloudflare",
      resource: "search",
    });
    expect(failure).toMatchObject({ code: "search_unavailable", status: 502 });
  });

  test("produces structured JSON with response metadata headers", async () => {
    stubFetch((url) => respond(url, { code: 200, results: [post] }));
    const result = await succeed({
      full: true,
      q: "x-lookup",
      resource: "search",
    });
    const response = browseResponse(result, true);
    expect(response.headers["Content-Type"]).toContain("application/json");
    expect(response.headers).toMatchObject({
      "Cache-Control": "public, max-age=0, must-revalidate",
      Vary: "Accept",
    });
    expect(response.headers["X-Source"]).toBe("fxtwitter");
    expect(response.headers["X-Result-Count"]).toBe("1");
  });

  test("embeds the query payload and compact metrics in the payload", async () => {
    stubFetch((url) => respond(url, { code: 200, results: [post] }));
    const result = await succeed({
      full: true,
      q: "x-lookup",
      resource: "search",
    });
    const response = browseResponse(result, true);
    expect(JSON.parse(response.body)).toMatchObject({
      query: "x-lookup",
      resource: "search",
    });
    expect(result.markdown).toContain("0 likes");
  });

  test("rejects Obsidian output on browse resources", async () => {
    const failure = await failureOf({
      format: "obsidian",
      handle: "ada",
      resource: "profile",
    });
    expect(failure).toMatchObject({
      _tag: "InvalidBrowseFormat",
      code: "invalid_format",
      status: 400,
    });
  });

  test("separates cache entries by output format", async () => {
    stubFetch((url) => respond(url, { code: 200, results: [post] }));

    const json = await succeed({
      format: "json",
      q: "x-lookup",
      resource: "search",
    });
    expect(json.cache).toBe("miss");

    const repeat = await succeed({
      format: "json",
      q: "x-lookup",
      resource: "search",
    });
    expect(repeat.cache).toBe("hit");

    const markdown = await succeed({
      format: "markdown",
      q: "x-lookup",
      resource: "search",
    });
    expect(markdown.cache).toBe("miss");
  });
});

describe(isOriginalPost, () => {
  test("provider filtering identifies replies and reposts", () => {
    expect(isOriginalPost(post)).toBeTruthy();
    expect(isOriginalPost({ ...post, replying_to_status: ["9"] })).toBeFalsy();
    expect(
      isOriginalPost({ ...post, reposted_by: { screen_name: "bob" } })
    ).toBeFalsy();
  });
});
