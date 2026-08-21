import { Result } from "effect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

import { convertTweet, markdownResponse } from "../lib/converter.js";
import { ConvertError } from "../lib/errors.js";

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

/** Unwrap a convert result, failing the test when it is a typed failure. */
const succeed = async (input: Parameters<typeof convertTweet>[0]) => {
  const result = await convertTweet(input);
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

/** Extract the typed failure of a convert call, failing the test on success. */
const failureOf = async (input: Parameters<typeof convertTweet>[0]) => {
  const result = await convertTweet(input);
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

describe("output selection", () => {
  const validUrl = "https://x.com/testuser/status/1234567890";

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test("defaults to compact and full=true restores rich rendering", async () => {
    stubFetch((url) =>
      respond(url, {
        code: 200,
        status: {
          author: { name: "Test", screen_name: "testuser" },
          created_at: "today",
          id: "1234567890",
          likes: 5,
          text: "hello",
        },
      })
    );

    const compact = await succeed({ url: validUrl });
    expect(compact.body).not.toContain("Stats:");

    const full = await succeed({ full: "true", url: validUrl });
    expect(full.body).toContain("Stats: 5 likes");
  });

  test("format=json is accepted and JSON contains structured posts and metadata", async () => {
    stubFetch((url) =>
      respond(url, {
        code: 200,
        status: {
          author: { name: "Test", screen_name: "testuser" },
          id: "1234567890",
          text: "hello",
        },
      })
    );

    const result = await succeed({ format: "json", url: validUrl });
    const response = markdownResponse(result, true);
    expect(response.headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(response.body)).toMatchObject({
      markdown: expect.stringContaining("hello"),
      posts: [{ id: "1234567890", url: validUrl }],
      source: "fxtwitter",
    });
  });

  test("varies negotiated responses by Accept and sets shared caching headers", async () => {
    stubFetch((url) =>
      respond(url, {
        code: 200,
        status: { id: "1234567890", text: "hello" },
      })
    );

    const result = await succeed({ url: validUrl });
    const response = markdownResponse(result);
    expect(response.headers).toMatchObject({
      "Cache-Control": "public, max-age=0, must-revalidate",
      Vary: "Accept, User-Agent",
      "X-Converter": "x-lookup",
    });
  });

  test("synthesizes source URLs for posts that lack them", async () => {
    const url = "https://x.com/urluser/status/1234567890";
    stubFetch((url2) => {
      if (url2.includes("/2/thread/")) {
        return respond(url2, {
          code: 200,
          thread: [{ author: { screen_name: "bob" }, id: "99", text: "reply" }],
        });
      }
      return respond(url2, { code: 200 });
    });

    const result = await succeed({
      format: "json",
      thread: "full",
      url,
    });
    expect(result.posts[0]).toMatchObject({
      context: "thread",
      id: "99",
      url: "https://x.com/bob/status/99",
    });
  });

  test("validates context and replies query values", async () => {
    expect(await failureOf({ context: "bad", url: validUrl })).toMatchObject({
      code: "invalid_context",
      status: 400,
    });
    await expect(
      convertTweet({ replies: "bad", url: validUrl })
    ).rejects.toMatchObject({ code: "invalid_replies" });
  });

  test("rejects unsupported input hosts and malformed paths", async () => {
    await expect(
      convertTweet({ url: "https://example.com/a/status/1" })
    ).rejects.toMatchObject({ code: "unsupported_host" });
    await expect(
      convertTweet({ url: "https://x.com/ada/followers" })
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(convertTweet({})).rejects.toMatchObject({
      code: "missing_url",
    });
  });

  test("accepts the production host and workers.dev previews as input URLs", async () => {
    stubFetch((url) =>
      respond(url, { code: 200, status: { id: "5", text: "hi" } })
    );
    await expect(
      convertTweet({ url: "https://x-lookup.mynameistito.com/ada/status/5" })
    ).resolves.toBeDefined();
    await expect(
      convertTweet({ url: "https://x-lookup.someone.workers.dev/ada/status/5" })
    ).resolves.toBeDefined();
  });
});

describe("parseThread — invalid values throw ConvertError", () => {
  const validUrl = "https://x.com/testuser/status/1234567890";

  test.each(["1", "101", "0", "-1", "abc", "invalid_mode", "200"])(
    "throws for thread=%s",
    async (thread) => {
      await expect(
        convertTweet({ thread, url: validUrl })
      ).rejects.toBeInstanceOf(ConvertError);
    }
  );

  test('error message includes "conversation", code is invalid_thread, status is 400', async () => {
    let failure: unknown;
    try {
      await convertTweet({ thread: "bad", url: validUrl });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConvertError);
    expect(failure).toMatchObject({ code: "invalid_thread", status: 400 });
    expect(String(failure)).toContain("conversation");
  });
});

describe("parseThread — valid values accepted", () => {
  const validUrl = "https://x.com/threaduser/status/1234567890";

  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFetch((url) =>
      respond(url, {
        code: 200,
        status: { id: "1234567890", text: "hello" },
      })
    );
  });

  test.each([
    null,
    undefined,
    "full",
    "conversation",
    "off",
    "2",
    "100",
    "50",
  ] as const)("thread=%s resolves without error", async (thread) => {
    await expect(
      convertTweet({ thread, url: validUrl })
    ).resolves.toBeDefined();
  });
});

describe("thread cache identity", () => {
  const validUrl = "https://x.com/cacheuser/status/1234567890";

  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFetch((url) =>
      respond(url, {
        code: 200,
        status: { id: "1234567890", text: "hello" },
      })
    );
  });

  test('null, "full", and "conversation" share one cache entry', async () => {
    const first = await convertTweet({ thread: null, url: validUrl });
    expect(first.cache).toBe("miss");
    const second = await convertTweet({ thread: "full", url: validUrl });
    expect(second.cache).toBe("hit");
    const third = await convertTweet({ thread: "conversation", url: validUrl });
    expect(third.cache).toBe("hit");
  });

  test('thread="off" gets its own cache entry', async () => {
    const off = await convertTweet({ thread: "off", url: validUrl });
    expect(off.cache).toBe("miss");
  });
});

describe("numeric thread limits", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test("preserve focal post and choose context by role before display ordering", async () => {
    stubFetch((url) => {
      if (url.includes("/2/thread/")) {
        return respond(url, {
          code: 200,
          thread: [
            { id: "1" },
            { id: "2" },
            { id: "3" },
            { id: "4" },
            { id: "5" },
          ],
        });
      }
      return respond(url, { code: 200 });
    });

    const result = await convertTweet({
      format: "json",
      thread: "2",
      url: "https://x.com/TestUser/status/3",
    });
    expect(result.posts.map((post) => post.id)).toStrictEqual(["2", "3"]);
    expect(result.warnings).toContain("Thread truncated to 2 posts.");
  });
});
