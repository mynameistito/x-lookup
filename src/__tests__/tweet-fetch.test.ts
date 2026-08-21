import { Option } from "effect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Mock } from "vitest";

import { parse as parsePostId } from "../lib/post-id.js";
import { fetchPosts } from "../lib/tweet-fetch.js";

const respond = <T>(url: string, body: T, status = 200): Promise<Response> => {
  if (!url.includes("api.fxtwitter.com") && !url.includes("cdn.syndication")) {
    return Promise.reject(new Error(`unexpected upstream: ${url}`));
  }
  return Promise.resolve(Response.json(body, { status }));
};

const stubFetch = (route: (url: string) => Promise<Response>): Mock => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(route);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/** Build a PostId through the real parser for tests. */
const pid = (raw: string): string => Option.getOrThrow(parsePostId(raw));

describe("fetchPosts provider fallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("falls back from FxTwitter to syndication for single statuses", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("api.fxtwitter.com")
        ? respond(url, {}, 500)
        : respond(url, {
            id_str: "123",
            text: "from syndication",
            user: { screen_name: "alice" },
          })
    );

    const result = await fetchPosts("alice", pid("123"), "off");

    expect(result.source).toBe("syndication");
    expect(result.tweets[0]).toMatchObject({
      context: "post",
      id: "123",
      text: "from syndication",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cdn.syndication");
  });

  test("prefers FxTwitter when it succeeds", async () => {
    const fetchMock = stubFetch((url) =>
      respond(url, { code: 200, status: { id: "123", text: "from fx" } })
    );

    const result = await fetchPosts("alice", pid("123"), "off");

    expect(result.source).toBe("fxtwitter");
    expect(result.tweets[0]).toMatchObject({ context: "post", id: "123" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/2/status/123");
  });

  test("private posts short-circuit without trying the fallback", async () => {
    const fetchMock = stubFetch((url) =>
      respond(url, { code: 403, message: "PRIVATE_TWEET" })
    );

    await expect(fetchPosts("alice", pid("123"), "off")).rejects.toMatchObject({
      code: "private_tweet",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("surfaces the last provider error when every attempt fails", async () => {
    stubFetch((url) => respond(url, {}, 500));

    await expect(fetchPosts("alice", pid("123"), "off")).rejects.toMatchObject({
      code: "syndication_error",
    });
  });

  test("reports a truthful 404 when a provider confirms the post is missing", async () => {
    stubFetch((url) =>
      url.includes("api.fxtwitter.com")
        ? respond(url, { code: 404, message: "NOT_FOUND" })
        : respond(url, {}, 500)
    );

    await expect(fetchPosts("alice", pid("123"), "off")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  test("thread=full starts with the FxTwitter full thread before any fallback", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/2/thread/")) {
        return respond(url, {
          code: 200,
          thread: [{ id: "1", text: "thread" }],
        });
      }
      return respond(url, { code: 200 });
    });

    const result = await fetchPosts("alice", pid("123"), "full");

    expect(result.source).toBe("fxtwitter");
    expect(result.tweets).toHaveLength(1);
    expect(result.tweets[0]).toMatchObject({
      context: "thread",
      id: "1",
      text: "thread",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/2/thread/123");
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/2/status/"))).toBeFalsy();
  });

  test("appends top replies in API order, caps, dedupes, and labels context", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/2/conversation/")) {
        return respond(url, {
          code: 200,
          replies: [
            { id: "3", replying_to: { status: "2" }, text: "duplicate" },
            { id: "4", replying_to: { status: "2" }, text: "reply" },
          ],
        });
      }
      return respond(url, {
        code: 200,
        thread: [
          { id: "1", text: "parent" },
          { id: "2", text: "post" },
          { id: "3", text: "continuation" },
        ],
      });
    });

    const result = await fetchPosts("alice", pid("2"), "full");

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "/2/conversation/2?ranking_mode=likes"
    );
    expect(
      result.tweets.map(({ context, id }) => ({ context, id }))
    ).toStrictEqual([
      { context: "parent", id: "1" },
      { context: "post", id: "2" },
      { context: "thread", id: "3" },
      { context: "reply", id: "4" },
    ]);
  });

  test("recent maps to recency and conversation failure keeps the thread", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/2/conversation/")) {
        return Promise.reject(new Error("conversation unavailable"));
      }
      if (url.includes("/2/thread/")) {
        return respond(url, { code: 200, thread: [{ id: "2", text: "post" }] });
      }
      return respond(url, { code: 200 });
    });

    const result = await fetchPosts(
      "alice",
      pid("2"),
      "full",
      "full",
      "recent"
    );

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "/2/conversation/2?ranking_mode=recency"
    );
    expect(result.tweets[0]).toMatchObject({
      context: "post",
      id: "2",
      text: "post",
    });
  });

  test("thread context and replies=off both opt out of conversation requests", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/2/thread/")) {
        return respond(url, { code: 200, thread: [{ id: "2" }] });
      }
      return respond(url, { code: 200 });
    });

    await fetchPosts("alice", pid("2"), "full", "thread", "top");
    await fetchPosts("alice", pid("2"), "full", "full", "off");

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/2/conversation/"))).toBeFalsy();
  });

  test("thread context retains only the focal author while replies=off preserves full parents", async () => {
    stubFetch((url) => {
      if (url.includes("/2/thread/")) {
        return respond(url, {
          code: 200,
          thread: [
            { author: { screen_name: "other" }, id: "1" },
            { author: { screen_name: "Alice" }, id: "2" },
            { author: { screen_name: "alice" }, id: "3" },
          ],
        });
      }
      return respond(url, { code: 200 });
    });

    const authorThread = await fetchPosts(
      "alice",
      "2",
      "full",
      "thread",
      "top"
    );
    expect(authorThread.tweets.map((tweet) => tweet.id)).toStrictEqual([
      "2",
      "3",
    ]);

    const noReplies = await fetchPosts(
      "alice",
      pid("2"),
      "full",
      "full",
      "off"
    );
    expect(noReplies.tweets.map((tweet) => tweet.id)).toStrictEqual([
      "1",
      "2",
      "3",
    ]);
  });

  test("uses the requested handle when focal author metadata is missing", async () => {
    stubFetch((url) => {
      if (url.includes("/2/thread/")) {
        return respond(url, {
          code: 200,
          thread: [
            { author: { screen_name: "other" }, id: "1" },
            { id: "2" },
            { author: { screen_name: "Alice" }, id: "3" },
          ],
        });
      }
      return respond(url, { code: 200 });
    });

    const result = await fetchPosts("alice", pid("2"), "full", "thread", "top");
    expect(result.tweets.map((tweet) => tweet.id)).toStrictEqual(["2", "3"]);
  });
});
