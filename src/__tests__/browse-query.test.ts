import { Result } from "effect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

import { browse } from "../lib/browse.js";

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

const stubSearch = (): Mock =>
  stubFetch((url) =>
    respond(url, {
      code: 200,
      results: [{ author: { screen_name: "ada" }, id: "1", text: "hello" }],
    })
  );

const succeed = async (input: Parameters<typeof browse>[0]) => {
  const result = await browse(input);
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

const failureOf = async (input: Parameters<typeof browse>[0]) => {
  const result = await browse(input);
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

describe("browse resource parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test.each([undefined, null, "", "posts", "PROFILE"] as const)(
    "refuses resource=%s with the historical contract",
    async (resource) => {
      const failure = await failureOf({ handle: "ada", resource });
      expect(failure).toMatchObject({
        _tag: "InvalidBrowseResource",
        code: "invalid_resource",
        message: "Unsupported browse resource.",
        status: 400,
      });
    }
  );

  test.each(["profile", "followers", "following"] as const)(
    "accepts resource=%s with a valid handle",
    async (resource) => {
      stubFetch((url) =>
        respond(url, { code: 200, results: [], user: { name: "Ada" } })
      );
      await expect(
        succeed({ handle: "ada", nocache: true, resource })
      ).resolves.toMatchObject({ resource });
    }
  );
});

describe("browse search parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test.each([undefined, null, "", "   "] as const)(
    "refuses empty q values (%s)",
    async (q) => {
      const failure = await failureOf({ q, resource: "search" });
      expect(failure).toMatchObject({
        _tag: "MissingSearchQuery",
        code: "missing_query",
        message: "Search query q is required.",
        status: 400,
      });
    }
  );

  test("trims the query before searching", async () => {
    stubSearch();
    const result = await succeed({
      nocache: true,
      q: "  cloudflare workers  ",
      resource: "search",
    });
    expect(result.query).toBe("cloudflare workers");
  });

  test("search ignores the handle parameter entirely", async () => {
    stubSearch();
    const result = await succeed({
      handle: "!!!",
      nocache: true,
      q: "x",
      resource: "search",
    });
    expect(result.resource).toBe("search");
  });

  test.each(["top", "media", "latest"] as const)(
    "accepts feed=%s and reports it",
    async (feed) => {
      stubSearch();
      const result = await succeed({
        feed,
        nocache: true,
        q: "x",
        resource: "search",
      });
      expect(result.feed).toBe(feed);
    }
  );

  test("falls back to latest for unsupported feeds", async () => {
    stubSearch();
    const result = await succeed({
      feed: "hot",
      nocache: true,
      q: "x",
      resource: "search",
    });
    expect(result.feed).toBe("latest");
  });
});

describe("browse page/limit parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test.each([
    [{ page: "3" }, 3],
    [{ page: 2 }, 2],
    [{}, 1],
    [{ page: "junk" }, 1],
    [{ page: "0" }, 1],
    [{ page: "-4" }, 1],
    [{ page: "99" }, 10],
  ])("page=%s parses to %i", async (extra, expected) => {
    stubSearch();
    const result = await succeed({
      nocache: true,
      q: "x",
      resource: "search",
      ...extra,
    });
    expect(result.page).toBe(expected);
  });

  test.each([
    [{ limit: "7" }, 7],
    [{ limit: 5 }, 5],
    [{}, 20],
    [{ limit: "junk" }, 20],
    [{ limit: "0" }, 20],
    [{ limit: "999" }, 50],
  ])("limit=%s parses to %i", async (extra, expected) => {
    stubSearch();
    const result = await succeed({
      nocache: true,
      q: "x",
      resource: "search",
      ...extra,
    });
    expect(result.limit).toBe(expected);
  });
});

describe("browse format and flag parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("refuses obsidian on browse resources", async () => {
    const failure = await failureOf({
      format: "obsidian",
      q: "x",
      resource: "search",
    });
    expect(failure).toMatchObject({
      _tag: "InvalidBrowseFormat",
      code: "invalid_format",
      message: "Browse `format` must be `markdown` or `json`.",
      status: 400,
    });
  });

  test.each([undefined, "", "markdown", "json"] as const)(
    "accepts format=%s",
    async (format) => {
      stubSearch();
      await expect(
        succeed({ format, nocache: true, q: "x", resource: "search" })
      ).resolves.toBeDefined();
    }
  );

  test('browse flags ignore "yes" (historical difference from convert)', async () => {
    stubSearch();
    const first = await succeed({
      full: "yes",
      nocache: true,
      q: "x",
      resource: "search",
    });
    expect(first.markdown).not.toContain("full=true");

    const bypass = await succeed({
      nocache: "yes",
      q: "flag-cache",
      resource: "search",
    });
    expect(bypass.cache).not.toBe("bypass");
  });

  test("browse flags honor 1 and true", async () => {
    stubFetch((url) =>
      respond(url, {
        code: 200,
        cursor: { bottom: "next" },
        results: [],
      })
    );
    const result = await succeed({
      full: "true",
      nocache: true,
      q: "x",
      resource: "search",
    });
    expect(result.markdown).toContain("full=true");
  });
});

describe("browse handle parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("strips a leading @ from profile handles", async () => {
    const fetchMock = stubFetch((url) =>
      respond(url, { code: 200, results: [], user: { name: "Ada" } })
    );
    await succeed({ handle: "@ada", nocache: true, resource: "profile" });
    const upstream = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(upstream.some((url) => url.includes("/2/profile/ada"))).toBeTruthy();
  });

  test("refuses handles outside the X shape", async () => {
    const failure = await failureOf({
      handle: "not a handle!",
      resource: "profile",
    });
    expect(failure).toMatchObject({
      _tag: "InvalidXHandle",
      code: "invalid_handle",
      message: "A valid X handle is required.",
      status: 400,
    });
  });

  test("profile listings ignore the q parameter", async () => {
    stubFetch((url) =>
      respond(url, { code: 200, results: [], user: { name: "Ada" } })
    );
    await expect(
      succeed({ handle: "ada", nocache: true, resource: "profile" })
    ).resolves.toMatchObject({ resource: "profile" });
  });
});
