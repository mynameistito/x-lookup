import { describe, test, expect, vi, beforeEach } from "vitest";

import { ConvertError } from "../lib/errors.js";
import {
  getParentStatusId,
  fetchFxConversationChain,
  fetchFxConversationReplies,
  fetchFxFullThread,
  fetchFxProfile,
  searchFxStatuses,
} from "../lib/fxtwitter.js";
import type { FxTweet, FxReplyingTo } from "../lib/fxtwitter.js";

function makeTweet(id: string, overrides: Partial<FxTweet> = {}): FxTweet {
  return { id, text: `tweet ${id}`, ...overrides };
}

function fxStatusResponse(tweet: FxTweet) {
  return { code: 200, status: tweet };
}

function fxThreadResponse(thread: FxTweet[]) {
  return { code: 200, thread };
}

describe(getParentStatusId, () => {
  test("returns status from object replying_to", () => {
    const tweet = makeTweet("200", {
      replying_to: {
        screen_name: "alice",
        status: "100",
        url: "https://x.com/alice/status/100",
      },
    });
    expect(getParentStatusId(tweet)).toBe("100");
  });

  test("skips array replying_to and falls back to replying_to_status", () => {
    const tweet = makeTweet("200", {
      replying_to: ["alice"],
      replying_to_status: ["100"],
    });
    expect(getParentStatusId(tweet)).toBe("100");
  });

  test("returns replying_to_status[0] when replying_to is null or undefined", () => {
    expect(
      getParentStatusId(
        makeTweet("200", { replying_to: null, replying_to_status: ["100"] })
      )
    ).toBe("100");
    expect(
      getParentStatusId(makeTweet("200", { replying_to_status: ["100"] }))
    ).toBe("100");
  });

  test("returns undefined when parent identity is absent", () => {
    expect(getParentStatusId(makeTweet("100"))).toBeUndefined();
    expect(
      getParentStatusId(
        makeTweet("200", {
          replying_to: { screen_name: "alice" } as FxReplyingTo,
        })
      )
    ).toBeUndefined();
    expect(
      getParentStatusId(
        makeTweet("200", { replying_to: [], replying_to_status: null })
      )
    ).toBeUndefined();
  });

  test("prefers object replying_to.status and coerces to string", () => {
    const tweet = makeTweet("300", {
      replying_to: { status: "200" } as FxReplyingTo,
      replying_to_status: ["999"],
    });
    expect(getParentStatusId(tweet)).toBe("200");
    expect(getParentStatusId(tweet)).toBeTypeOf("string");
  });
});

describe(fetchFxConversationChain, () => {
  beforeEach(() => vi.restoreAllMocks());

  test("returns a single tweet when it has no parent", async () => {
    const tweet = makeTweet("100");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(fxStatusResponse(tweet)), { status: 200 })
        )
    );

    const result = await fetchFxConversationChain("100");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("100");
  });

  test("walks the parent chain root-first across long threads", async () => {
    const chain: Record<string, FxTweet> = {
      "100": makeTweet("100"),
      "200": makeTweet("200", {
        replying_to: { status: "100" } as FxReplyingTo,
      }),
      "300": makeTweet("300", {
        replying_to: { status: "200" } as FxReplyingTo,
      }),
      "400": makeTweet("400", {
        replying_to: { status: "300" } as FxReplyingTo,
      }),
      "500": makeTweet("500", {
        replying_to: { status: "400" } as FxReplyingTo,
      }),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const id = Object.keys(chain).find((k) => url.includes(`/status/${k}`));
        const tweet = id ? chain[id] : chain["100"];
        return Promise.resolve(
          new Response(JSON.stringify(fxStatusResponse(tweet)), { status: 200 })
        );
      })
    );

    const result = await fetchFxConversationChain("500");
    expect(result.map((t) => t.id)).toStrictEqual([
      "100",
      "200",
      "300",
      "400",
      "500",
    ]);
  });

  test("stops walking when a cycle is detected", async () => {
    const tweetA = makeTweet("100", {
      replying_to: { status: "200" } as FxReplyingTo,
    });
    const tweetB = makeTweet("200", {
      replying_to: { status: "100" } as FxReplyingTo,
    });
    let callCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        callCount++;
        const tweet = url.includes("/status/100") ? tweetA : tweetB;
        return Promise.resolve(
          new Response(JSON.stringify(fxStatusResponse(tweet)), { status: 200 })
        );
      })
    );

    const result = await fetchFxConversationChain("200");
    expect(result.length).toBeLessThanOrEqual(100);
    expect(callCount).toBeLessThanOrEqual(3);
  });

  test("uses replying_to_status fallback for parent resolution", async () => {
    const root = makeTweet("100");
    const leaf = makeTweet("200", {
      replying_to: ["alice"],
      replying_to_status: ["100"],
    });
    const tweets: Record<string, FxTweet> = { "100": root, "200": leaf };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const id = Object.keys(tweets).find((k) =>
          url.includes(`/status/${k}`)
        );
        const tweet = id ? tweets[id] : root;
        return Promise.resolve(
          new Response(JSON.stringify(fxStatusResponse(tweet)), { status: 200 })
        );
      })
    );

    const result = await fetchFxConversationChain("200");
    expect(result.map((t) => t.id)).toStrictEqual(["100", "200"]);
  });

  test("normalizes real FxTwitter media formats and nested quotes recursively", async () => {
    const tweet = makeTweet("20", {
      media: {
        videos: [
          {
            duration: 4.5,
            formats: [
              {
                bitrate: 832000,
                codec: "avc1",
                container: "video/mp4",
                url: "https://video/high.mp4",
              },
            ],
            type: "video",
          },
        ],
      },
      quote: {
        id: "30",
        quote: {
          id: "40",
          media: { videos: [{ duration: 2, type: "video" }] },
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(fxStatusResponse(tweet)), { status: 200 })
        )
    );
    const result = await fetchFxConversationChain("20");
    expect(result[0].media?.videos?.[0]).toMatchObject({
      duration_ms: 4500,
      variants: [
        {
          bitrate: 832_000,
          content_type: "video/mp4",
          url: "https://video/high.mp4",
        },
      ],
    });
    expect(result[0].quote?.quote?.media?.videos?.[0]?.duration_ms).toBe(2000);
  });
});

describe(fetchFxFullThread, () => {
  beforeEach(() => vi.restoreAllMocks());

  test("returns multi-tweet thread directly when thread endpoint returns >1 tweets", async () => {
    const tweets = [makeTweet("100"), makeTweet("200"), makeTweet("300")];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(fxThreadResponse(tweets)), {
          status: 200,
        })
      )
    );

    const result = await fetchFxFullThread("300");
    expect(result.map((t) => t.id)).toStrictEqual(["100", "200", "300"]);
  });

  test("returns single tweet directly when it has no parent", async () => {
    const tweet = makeTweet("100");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/thread/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ code: 200, thread: [tweet] }), {
              status: 200,
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(fxStatusResponse(tweet)), { status: 200 })
        );
      })
    );

    const result = await fetchFxFullThread("100");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("100");
  });

  test("falls back to conversation chain when thread endpoint returns single tweet with parent", async () => {
    const root = makeTweet("100");
    const leaf = makeTweet("200", {
      replying_to: { status: "100" } as FxReplyingTo,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/thread/")) {
          return Promise.resolve(
            new Response(JSON.stringify({ code: 200, thread: [leaf] }), {
              status: 200,
            })
          );
        }
        if (url.includes("/status/100")) {
          return Promise.resolve(
            new Response(JSON.stringify(fxStatusResponse(root)), {
              status: 200,
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(fxStatusResponse(leaf)), { status: 200 })
        );
      })
    );

    const result = await fetchFxFullThread("200");
    expect(result.map((t) => t.id)).toStrictEqual(["100", "200"]);
  });
});

describe(fetchFxConversationReplies, () => {
  test("keeps only direct replies, sorts by recency, caps, and sends ranking_mode", async () => {
    const replies = Array.from({ length: 12 }, (_, index) =>
      makeTweet(String(index + 1), {
        created_timestamp: index,
        likes: index,
        replying_to:
          index === 0
            ? { status: "other" }
            : (index === 1
              ? undefined
              : { status: "20" }),
      })
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 200, replies }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFxConversationReplies("20", "recency", 10);

    expect(result.map((tweet) => tweet.id)).toStrictEqual([
      "12",
      "11",
      "10",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/2/conversation/20?ranking_mode=recency"
    );
  });
});

describe("upstream refusal gating", () => {
  beforeEach(() => vi.restoreAllMocks());

  test("search maps upstream NOT_FOUND to 502 search_unavailable, never a fake 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 404, message: "NOT_FOUND" }), {
          status: 200,
        })
      )
    );

    const error = await searchFxStatuses("cloudflare", "latest").catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).status).toBe(502);
    expect((error as ConvertError).code).toBe("search_unavailable");
  });

  test("search still returns real results when upstream cooperates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 200,
            cursor: { bottom: "next" },
            results: [makeTweet("1")],
          }),
          { status: 200 }
        )
      )
    );

    const result = await searchFxStatuses("cloudflare", "latest");
    expect(result.results.map((tweet) => tweet.id)).toStrictEqual(["1"]);
    expect(result.cursor?.bottom).toBe("next");
  });

  test("profile lookups keep truthful 404s for genuinely missing users", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 404, message: "NOT_FOUND" }), {
          status: 200,
        })
      )
    );

    const error = await fetchFxProfile("nobody").catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).status).toBe(404);
    expect((error as ConvertError).code).toBe("not_found");
  });

  test("non-JSON upstream bodies surface as 502 instead of crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>blocked</html>", { status: 403 })
        )
    );

    const error = await fetchFxProfile("anyone").catch(
      (error: unknown) => error
    );
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).status).toBe(502);
    expect((error as ConvertError).code).toBe("fxtwitter_error");
  });
});
