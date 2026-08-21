import { beforeEach, describe, expect, test, vi } from "vitest";

import { ConvertError } from "../lib/errors.js";

vi.mock(import('../lib/fxtwitter.js'), () => ({
  fetchFxConversationReplies: vi.fn(),
  fetchFxFullThread: vi.fn(),
  fetchFxStatus: vi.fn(),
}));

vi.mock(import('../lib/syndication.js'), () => ({
  fetchSyndicationStatus: vi.fn(),
}));

import {
  fetchFxConversationReplies,
  fetchFxFullThread,
  fetchFxStatus,
} from "../lib/fxtwitter.js";
import { fetchSyndicationStatus } from "../lib/syndication.js";
import { fetchPosts } from "../lib/tweet-fetch.js";

describe("fetchPosts provider fallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("falls back from FxTwitter to syndication for single statuses", async () => {
    vi.mocked(fetchFxStatus).mockRejectedValue(
      new ConvertError(502, "fx down", "fxtwitter_error")
    );
    vi.mocked(fetchSyndicationStatus).mockResolvedValue({
      id: "123",
      text: "from syndication",
    });

    const result = await fetchPosts("alice", "123", "off");

    expect(result).toStrictEqual({
      source: "syndication",
      tweets: [{ id: "123", text: "from syndication", context: "post" }],
    });
    expect(fetchSyndicationStatus).toHaveBeenCalledWith("alice", "123");
  });

  test("prefers FxTwitter when it succeeds", async () => {
    vi.mocked(fetchFxStatus).mockResolvedValue({ id: "123", text: "from fx" });

    const result = await fetchPosts("alice", "123", "off");

    expect(result.source).toBe("fxtwitter");
    expect(fetchSyndicationStatus).not.toHaveBeenCalled();
  });

  test("private posts short-circuit without trying the fallback", async () => {
    vi.mocked(fetchFxStatus).mockRejectedValue(
      new ConvertError(404, "Post is private.", "private_tweet")
    );

    await expect(fetchPosts("alice", "123", "off")).rejects.toMatchObject({
      code: "private_tweet",
    });
    expect(fetchSyndicationStatus).not.toHaveBeenCalled();
  });

  test("surfaces the last provider error when every attempt fails", async () => {
    vi.mocked(fetchFxStatus).mockRejectedValue(
      new ConvertError(502, "fx down", "fxtwitter_error")
    );
    vi.mocked(fetchSyndicationStatus).mockRejectedValue(
      new ConvertError(502, "syndication down", "syndication_error")
    );

    const error = await fetchPosts("alice", "123", "off").catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).code).toBe("syndication_error");
  });

  test("reports a truthful 404 when a provider confirms the post is missing", async () => {
    vi.mocked(fetchFxStatus).mockRejectedValue(
      new ConvertError(404, "Post not found.", "not_found")
    );
    vi.mocked(fetchSyndicationStatus).mockRejectedValue(
      new ConvertError(502, "syndication down", "syndication_error")
    );

    const error = await fetchPosts("alice", "123", "off").catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).status).toBe(404);
    expect((error as ConvertError).code).toBe("not_found");
  });

  test("thread=full starts with the FxTwitter full thread before any fallback", async () => {
    vi.mocked(fetchFxFullThread).mockResolvedValue([
      { id: "1", text: "thread" },
    ]);

    const result = await fetchPosts("alice", "123", "full");

    expect(result).toStrictEqual({
      source: "fxtwitter",
      tweets: [{ id: "1", text: "thread", context: "thread" }],
    });
    expect(fetchFxFullThread).toHaveBeenCalledWith("123");
    expect(fetchFxStatus).not.toHaveBeenCalled();
  });

  test("appends top replies in API order, caps, dedupes, and labels context", async () => {
    vi.mocked(fetchFxFullThread).mockResolvedValue([
      { id: "1", text: "parent" },
      { id: "2", text: "post" },
      { id: "3", text: "continuation" },
    ]);
    vi.mocked(fetchFxConversationReplies).mockResolvedValue([
      { id: "3", text: "duplicate" },
      { id: "4", text: "reply" },
    ]);

    const result = await fetchPosts("alice", "2", "full");

    expect(fetchFxConversationReplies).toHaveBeenCalledWith("2", "likes", 10);
    expect(result.tweets.map(({ id, context }) => ({ context, id }))).toStrictEqual([
      { context: "parent", id: "1" },
      { context: "post", id: "2" },
      { context: "thread", id: "3" },
      { context: "reply", id: "4" },
    ]);
  });

  test("recent maps to recency and conversation failure keeps the thread", async () => {
    vi.mocked(fetchFxFullThread).mockResolvedValue([{ id: "2", text: "post" }]);
    vi.mocked(fetchFxConversationReplies).mockRejectedValue(
      new Error("conversation unavailable")
    );
    const result = await fetchPosts("alice", "2", "full", "full", "recent");
    expect(fetchFxConversationReplies).toHaveBeenCalledWith("2", "recency", 10);
    expect(result.tweets).toStrictEqual([{ context: "post", id: "2", text: "post" }]);
  });

  test("thread context and replies=off both opt out of conversation requests", async () => {
    vi.mocked(fetchFxFullThread).mockResolvedValue([{ id: "2" }]);
    await fetchPosts("alice", "2", "full", "thread", "top");
    await fetchPosts("alice", "2", "full", "full", "off");
    expect(fetchFxConversationReplies).not.toHaveBeenCalled();
  });

  test("thread context retains only the focal author while replies=off preserves full parents", async () => {
    vi.mocked(fetchFxFullThread).mockResolvedValue([
      { author: { screen_name: "other" }, id: "1" },
      { author: { screen_name: "Alice" }, id: "2" },
      { author: { screen_name: "alice" }, id: "3" },
    ]);
    const authorThread = await fetchPosts(
      "alice",
      "2",
      "full",
      "thread",
      "top"
    );
    expect(authorThread.tweets.map((tweet) => tweet.id)).toStrictEqual(["2", "3"]);
    const noReplies = await fetchPosts("alice", "2", "full", "full", "off");
    expect(noReplies.tweets.map((tweet) => tweet.id)).toStrictEqual(["1", "2", "3"]);
  });

  test("uses the requested handle when focal author metadata is missing", async () => {
    vi.mocked(fetchFxFullThread).mockResolvedValue([
      { author: { screen_name: "other" }, id: "1" },
      { id: "2" },
      { author: { screen_name: "Alice" }, id: "3" },
    ]);

    const result = await fetchPosts("alice", "2", "full", "thread", "top");
    expect(result.tweets.map((tweet) => tweet.id)).toStrictEqual(["2", "3"]);
  });
});
