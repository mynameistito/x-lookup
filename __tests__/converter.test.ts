import { Effect, Layer, Result } from "effect";
import { describe, expect, test } from "vitest";

import { layerMemory } from "@/lib/cache.ts";
import {
  convertTweetEffect,
  layerConversionWithoutDependencies,
} from "@/lib/converter.ts";
import type { FxTweet } from "@/lib/fxtwitter-types.ts";
import { markdownResponse } from "@/lib/http-presenter.ts";
import { renderThreadMarkdown } from "@/lib/markdown.ts";
import { PostLookup } from "@/lib/tweet-fetch.ts";
import type { FetchResult, PostLookupService } from "@/lib/tweet-fetch.ts";

const validUrl = "https://x.com/testuser/status/1234567890";

const makeTweet = (id: string, overrides: Partial<FxTweet> = {}): FxTweet => ({
  id,
  text: `post ${id}`,
  ...overrides,
});

const defaultLookup: PostLookupService["lookup"] = (input) =>
  Effect.succeed({
    source: "fxtwitter",
    tweets: [
      makeTweet(input.id, {
        author: { name: "Test", screen_name: input.handle },
        context: "post",
        likes: 5,
        text: "hello",
      }),
    ],
  });

const conversionLayer = (lookup: PostLookupService["lookup"] = defaultLookup) =>
  layerConversionWithoutDependencies.pipe(
    Layer.provide([
      layerMemory(),
      Layer.succeed(PostLookup, PostLookup.of({ lookup })),
    ])
  );

const runConvert = (
  input: Parameters<typeof convertTweetEffect>[0],
  lookup: PostLookupService["lookup"] = defaultLookup
) =>
  Effect.runPromise(
    Effect.result(
      Effect.provide(convertTweetEffect(input), conversionLayer(lookup))
    )
  );

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error(`expected success: ${String(result.failure)}`);
  }
  return result.success;
};

describe("Conversion", () => {
  test("defaults to compact rendering and full=true restores rich metrics", async () => {
    const compact = requireSuccess(await runConvert({ url: validUrl }));
    expect(markdownResponse(compact).body).not.toContain("Stats:");

    const full = requireSuccess(
      await runConvert({ full: "true", url: validUrl })
    );
    expect(markdownResponse(full).body).toContain("Stats: 5 likes");
  });

  test("format=json keeps structured posts and stable result metadata", async () => {
    const result = requireSuccess(
      await runConvert({ format: "json", url: validUrl })
    );
    const response = markdownResponse(result, true);
    expect(response.headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(response.body)).toMatchObject({
      cache: "miss",
      compact: true,
      markdown: expect.stringContaining("hello"),
      postCount: 1,
      posts: [{ id: "1234567890", url: validUrl }],
      source: "fxtwitter",
      url: validUrl,
      warnings: [],
    });
  });

  test("varies negotiated responses by Accept/User-Agent and preserves cache headers", async () => {
    const result = requireSuccess(await runConvert({ url: validUrl }));
    const response = markdownResponse(result);
    expect(response.headers).toMatchObject({
      "Cache-Control": "public, max-age=0, must-revalidate",
      Vary: "Accept, User-Agent",
      "X-Cache": "MISS",
      "X-Converter": "x-lookup",
      "X-Post-Count": "1",
      "X-Source": "fxtwitter",
      "X-Warnings": "0",
    });
  });

  test("synthesizes canonical source URLs for posts that lack them", async () => {
    const result = requireSuccess(
      await runConvert(
        {
          format: "json",
          thread: "full",
          url: "https://x.com/urluser/status/1234567890",
        },
        () =>
          Effect.succeed({
            source: "fxtwitter",
            tweets: [
              makeTweet("99", {
                author: { screen_name: "bob" },
                context: "thread",
                text: "reply",
              }),
            ],
          })
      )
    );
    expect(result.posts[0]).toMatchObject({
      context: "thread",
      id: "99",
      url: "https://x.com/bob/status/99",
    });
  });

  test("fails invalid context/replies before invoking post lookup", async () => {
    let calls = 0;
    const lookup: PostLookupService["lookup"] = (input) => {
      calls += 1;
      return defaultLookup(input);
    };
    const invalidContext = await runConvert(
      { context: "bad", url: validUrl },
      lookup
    );
    const invalidReplies = await runConvert(
      { replies: "bad", url: validUrl },
      lookup
    );
    expect(invalidContext).toMatchObject({
      _tag: "Failure",
      failure: { code: "invalid_context", status: 400 },
    });
    expect(invalidReplies).toMatchObject({
      _tag: "Failure",
      failure: { code: "invalid_replies", status: 400 },
    });
    expect(calls).toBe(0);
  });

  test("rejects unsupported hosts, malformed paths, and missing targets", async () => {
    await expect(
      runConvert({ url: "https://example.com/a/status/1" })
    ).resolves.toMatchObject({
      _tag: "Failure",
      failure: { code: "unsupported_host", status: 400 },
    });
    await expect(
      runConvert({ url: "https://x.com/ada/followers" })
    ).resolves.toMatchObject({
      _tag: "Failure",
      failure: { code: "invalid_path", status: 400 },
    });
    await expect(runConvert({})).resolves.toMatchObject({
      _tag: "Failure",
      failure: { code: "missing_url", status: 400 },
    });
  });

  test("shares cache identity for default/full/conversation and separates thread=off", async () => {
    let lookups = 0;
    const lookup: PostLookupService["lookup"] = (input) => {
      lookups += 1;
      return defaultLookup(input);
    };
    const layer = conversionLayer(lookup);
    const [defaultResult, full, conversation, off] = await Effect.runPromise(
      Effect.provide(
        Effect.all([
          Effect.result(
            convertTweetEffect({
              url: "https://x.com/cacheuser/status/1234567890",
            })
          ),
          Effect.result(
            convertTweetEffect({
              thread: "full",
              url: "https://x.com/cacheuser/status/1234567890",
            })
          ),
          Effect.result(
            convertTweetEffect({
              thread: "conversation",
              url: "https://x.com/cacheuser/status/1234567890",
            })
          ),
          Effect.result(
            convertTweetEffect({
              thread: "off",
              url: "https://x.com/cacheuser/status/1234567890",
            })
          ),
        ]),
        layer
      )
    );
    expect(requireSuccess(defaultResult).cache).toBe("miss");
    expect(requireSuccess(full).cache).toBe("hit");
    expect(requireSuccess(conversation).cache).toBe("hit");
    expect(requireSuccess(off).cache).toBe("miss");
    expect(lookups).toBe(2);
  });

  test("preserves focal post and role priority when truncating threads", async () => {
    const result = requireSuccess(
      await runConvert(
        {
          format: "json",
          thread: "2",
          url: "https://x.com/TestUser/status/3",
        },
        () =>
          Effect.succeed({
            source: "fxtwitter",
            tweets: [
              makeTweet("1", { context: "parent" }),
              makeTweet("2", { context: "parent" }),
              makeTweet("3", { context: "post" }),
              makeTweet("4", { context: "thread" }),
              makeTweet("5", { context: "reply" }),
            ],
          })
      )
    );
    expect(result.posts.map((post) => post.id)).toStrictEqual(["2", "3"]);
    expect(result.warnings).toContain("Thread truncated to 2 posts.");
  });

  test("keeps fallback warnings, canonical URLs, Markdown, and result metadata stable", async () => {
    const result = requireSuccess(
      await runConvert(
        {
          format: "json",
          thread: "2",
          url: "https://x.com/ada/status/3",
        },
        () =>
          Effect.succeed({
            source: "syndication",
            tweets: [
              makeTweet("2", {
                author: { name: "Ada", screen_name: "ada" },
                context: "parent",
                text: "parent",
              }),
              makeTweet("3", {
                author: { name: "Ada", screen_name: "ada" },
                context: "post",
                text: "focal",
              }),
              makeTweet("4", {
                author: { name: "Bob", screen_name: "bob" },
                context: "reply",
                text: "reply",
              }),
            ],
          } satisfies FetchResult)
      )
    );

    expect(result).toMatchObject({
      cache: "miss",
      canonicalUrl: "https://x.com/ada/status/3",
      compact: true,
      format: "json",
      postCount: 2,
      source: "syndication",
      warnings: [
        "Thread truncated to 2 posts.",
        "Fetched via syndication fallback — threads, full articles, and quotes may be limited.",
      ],
    });
    expect(result.posts.map((tweet) => [tweet.id, tweet.url])).toStrictEqual([
      ["2", "https://x.com/ada/status/2"],
      ["3", "https://x.com/ada/status/3"],
    ]);
    expect(
      renderThreadMarkdown(result.posts, {
        canonicalUrl: result.canonicalUrl,
        compact: result.compact,
        format: "markdown",
        userinfo: result.userinfo,
      })
    ).toBe(`## Parent · 1/2 — Parent · Ada (@ada)

parent

Source: https://x.com/ada/status/2
---

## Post · 2/2 — Post · Ada (@ada)

focal

Source: https://x.com/ada/status/3`);
  });
});
