import { Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";
import { describe, expect, test } from "vitest";

import {
  fetchFxConnectionsEffect,
  fetchFxConversationRepliesEffect,
  fetchFxProfileEffect,
  fetchFxProfileStatusesEffect,
  fetchFxStatusEffect,
  fetchFxThreadEffect,
  searchFxStatusesEffect,
} from "@/providers/fxtwitter/adapter.ts";
import type { ProviderEffect } from "@/providers/http-client.ts";
import { fetchSyndicationStatusEffect } from "@/providers/syndication/adapter.ts";

const makeClient = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response
): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request)))
  );

const runWithClient = <A, E>(
  program: ProviderEffect<A, E>,
  client: HttpClient.HttpClient
): Promise<A> =>
  Effect.runPromise(
    program.pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient, client)))
  );

const networkFailureClient: HttpClient.HttpClient = HttpClient.make((request) =>
  Effect.fail(
    new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({
        cause: new Error("network down"),
        request,
      }),
    })
  )
);

const parentFor = (index: number): { readonly status: string } | undefined => {
  if (index === 0) {
    return { status: "other" };
  }
  if (index === 1) {
    return undefined;
  }
  return { status: "20" };
};

describe("FxTwitter Effect adapter", () => {
  test("decodes statuses and preserves media normalization", async () => {
    const client = makeClient(() =>
      Response.json({
        code: 200,
        status: {
          author: { name: "Alice", screen_name: "alice" },
          id: "123",
          media: {
            videos: [
              {
                altText: "demo video",
                duration: 4.5,
                formats: [
                  {
                    bitrate: 832_000,
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
            id: "456",
            media: { videos: [{ duration: 2, type: "video" }] },
            text: "quoted",
          },
          reposts: 7,
          text: "hello",
        },
      })
    );

    const tweet = await runWithClient(fetchFxStatusEffect("123"), client);

    expect(tweet).toMatchObject({
      id: "123",
      retweets: 7,
      text: "hello",
    });
    expect(tweet.media?.videos?.[0]).toMatchObject({
      alt: "demo video",
      duration_ms: 4500,
      variants: [
        {
          bitrate: 832_000,
          content_type: "video/mp4",
          url: "https://video/high.mp4",
        },
      ],
    });
    expect(tweet.quote?.media?.videos?.[0]?.duration_ms).toBe(2000);
  });

  test("decodes profile, list, search, and connection shapes used by the app", async () => {
    const requests: string[] = [];
    const client = makeClient((request) => {
      requests.push(request.url);
      if (request.url.includes("/statuses")) {
        return Response.json({
          code: 200,
          cursor: { bottom: "posts-next" },
          results: [{ id: "10", text: "post" }],
        });
      }
      if (request.url.includes("/followers")) {
        return Response.json({
          code: 200,
          cursor: { bottom: "users-next" },
          results: [{ followers: 12, screen_name: "bob" }],
        });
      }
      if (request.url.includes("/2/search")) {
        return Response.json({
          code: 200,
          cursor: { bottom: "search-next" },
          results: [{ id: "11", text: "result" }],
        });
      }
      return Response.json({
        code: 200,
        user: {
          followers: 50,
          name: "Alice",
          screen_name: "alice",
        },
      });
    });

    const profile = await runWithClient(fetchFxProfileEffect("alice"), client);
    const statuses = await runWithClient(
      fetchFxProfileStatusesEffect("alice", undefined, 20),
      client
    );
    const followers = await runWithClient(
      fetchFxConnectionsEffect("alice", "followers", undefined, 20),
      client
    );
    const search = await runWithClient(
      searchFxStatusesEffect("effect", "latest", undefined, 20),
      client
    );

    expect(profile).toMatchObject({
      followers: 50,
      name: "Alice",
      screen_name: "alice",
    });
    expect(statuses).toMatchObject({
      cursor: { bottom: "posts-next" },
      results: [{ id: "10", text: "post" }],
    });
    expect(followers).toMatchObject({
      cursor: { bottom: "users-next" },
      results: [{ followers: 12, screen_name: "bob" }],
    });
    expect(search).toMatchObject({
      cursor: { bottom: "search-next" },
      results: [{ id: "11", text: "result" }],
    });
    expect(requests.some((url) => url.includes("q=effect"))).toBeTruthy();
  });

  test("decodes thread and conversation response variants", async () => {
    const client = makeClient((request) => {
      if (request.url.includes("/2/thread/")) {
        return Response.json({
          code: 200,
          thread: [
            { id: "1", text: "parent" },
            { id: "2", text: "post" },
          ],
        });
      }
      return Response.json({
        code: 200,
        conversation: [
          {
            created_timestamp: 2,
            id: "4",
            likes: 2,
            replying_to: { status: "2" },
          },
          {
            created_timestamp: 3,
            id: "5",
            likes: 10,
            replying_to: { status: "other" },
          },
          {
            created_timestamp: 1,
            id: "3",
            likes: 5,
            replying_to: { status: "2" },
          },
        ],
      });
    });

    const thread = await runWithClient(fetchFxThreadEffect("2"), client);
    const replies = await runWithClient(
      fetchFxConversationRepliesEffect("2", "likes", 10),
      client
    );

    expect(thread.map((tweet) => tweet.id)).toStrictEqual(["1", "2"]);
    expect(replies.map((tweet) => tweet.id)).toStrictEqual(["3", "4"]);
  });

  test("keeps only direct replies, ranks by recency, caps, and sends ranking_mode", async () => {
    const requests: string[] = [];
    const replies = Array.from({ length: 12 }, (_, index) => ({
      created_timestamp: index,
      id: String(index + 1),
      likes: index,
      replying_to: parentFor(index),
    }));
    const client = makeClient((request) => {
      requests.push(request.url);
      return Response.json({ code: 200, replies }, { status: 200 });
    });

    const result = await runWithClient(
      fetchFxConversationRepliesEffect("20", "recency", 10),
      client
    );

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
    expect(
      requests.some((url) =>
        url.includes("/2/conversation/20?ranking_mode=recency")
      )
    ).toBeTruthy();
  });

  test("accepts provider replies without parent metadata and numeric IDs", async () => {
    const client = makeClient(() =>
      Response.json({
        code: 200,
        replies: [
          { id: 2, likes: 4, text: "reply one" },
          { id: "3", likes: 2, text: "reply two" },
        ],
      })
    );

    const result = await runWithClient(
      fetchFxConversationRepliesEffect("20", "likes", 10),
      client
    );

    expect(result.map((tweet) => tweet.text)).toStrictEqual([
      "reply one",
      "reply two",
    ]);
  });

  test("classifies private, not-found, search refusal, and upstream failures", async () => {
    const privateClient = makeClient(() =>
      Response.json({ code: 403, message: "PRIVATE_TWEET" })
    );
    await expect(
      runWithClient(fetchFxStatusEffect("1"), privateClient)
    ).rejects.toMatchObject({ code: "private_tweet", status: 404 });

    const missingClient = makeClient(() =>
      Response.json({ code: 404, message: "NOT_FOUND" })
    );
    await expect(
      runWithClient(fetchFxStatusEffect("1"), missingClient)
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      runWithClient(searchFxStatusesEffect("x", "latest"), missingClient)
    ).rejects.toMatchObject({ code: "search_unavailable", status: 502 });

    const upstreamClient = makeClient(() =>
      Response.json({ message: "temporarily unavailable" }, { status: 503 })
    );
    await expect(
      runWithClient(fetchFxStatusEffect("1"), upstreamClient)
    ).rejects.toMatchObject({
      code: "fxtwitter_error",
      status: 502,
      upstreamStatus: 503,
    });
  });

  test("classifies transport, non-JSON, and schema failures", async () => {
    await expect(
      runWithClient(fetchFxStatusEffect("1"), networkFailureClient)
    ).rejects.toMatchObject({ code: "fxtwitter_network", status: 502 });

    const nonJsonClient = makeClient(
      () => new Response("<html>blocked</html>")
    );
    await expect(
      runWithClient(fetchFxStatusEffect("1"), nonJsonClient)
    ).rejects.toMatchObject({ code: "fxtwitter_error", status: 502 });

    const malformedClient = makeClient(() =>
      Response.json({ code: "not-a-number", status: { id: "1" } })
    );
    await expect(
      runWithClient(fetchFxStatusEffect("1"), malformedClient)
    ).rejects.toMatchObject({
      _tag: "FxTwitterSchemaError",
      code: "fxtwitter_error",
      status: 502,
    });
  });
});

describe("syndication Effect adapter", () => {
  test("maps user, article, quote, media, and best MP4 variants", async () => {
    const client = makeClient(() =>
      Response.json({
        article: {
          cover_media: {
            media_info: { original_img_url: "https://img/cover.jpg" },
          },
          preview_text: "article preview",
          title: "Article title",
        },
        id_str: "123",
        mediaDetails: [
          {
            media_url_https: "https://img/thumb.jpg",
            original_info: { height: 720, width: 1280 },
            type: "video",
            video_info: {
              duration_millis: 4500,
              variants: [
                {
                  bitrate: 256_000,
                  content_type: "video/mp4",
                  url: "https://video/low.mp4",
                },
                {
                  bitrate: 832_000,
                  content_type: "video/mp4",
                  url: "https://video/high.mp4",
                },
                {
                  content_type: "application/x-mpegURL",
                  url: "https://video/stream.m3u8",
                },
              ],
            },
          },
        ],
        quoted_tweet: {
          id_str: "456",
          text: "quote",
          user: { screen_name: "bob" },
        },
        text: "container",
        user: {
          description: "bio",
          entities: {
            url: {
              urls: [
                {
                  display_url: "alice.dev",
                  expanded_url: "https://alice.dev",
                },
              ],
            },
          },
          followers_count: 10,
          friends_count: 20,
          name: "Alice",
          screen_name: "alice",
          statuses_count: 30,
        },
      })
    );

    const tweet = await runWithClient(
      fetchSyndicationStatusEffect("alice", "123"),
      client
    );

    expect(tweet.author).toMatchObject({
      followers: 10,
      following: 20,
      name: "Alice",
      screen_name: "alice",
      statuses: 30,
      website: { display_url: "alice.dev", url: "https://alice.dev" },
    });
    expect(tweet.article).toMatchObject({
      preview_text: "article preview",
      title: "Article title",
    });
    expect(tweet.quote).toMatchObject({
      id: "456",
      url: "https://x.com/bob/status/456",
    });
    expect(tweet.media?.videos?.[0]).toMatchObject({
      bitrate: 832_000,
      duration_ms: 4500,
      height: 720,
      url: "https://video/high.mp4",
      width: 1280,
    });
    expect(
      tweet.media?.videos?.[0]?.variants?.map((variant) => variant.url)
    ).toStrictEqual(["https://video/high.mp4", "https://video/low.mp4"]);
  });

  test("deduplicates fallback media projections", async () => {
    const client = makeClient(() =>
      Response.json({
        entities: {
          media: [
            { media_url_https: "https://img/one.jpg", type: "photo" },
            { media_url_https: "https://img/two.jpg", type: "photo" },
          ],
        },
        id_str: "123",
        photos: [{ media_url_https: "https://img/one.jpg", type: "photo" }],
        text: "photos",
        user: { screen_name: "alice" },
      })
    );

    const tweet = await runWithClient(
      fetchSyndicationStatusEffect("alice", "123"),
      client
    );

    expect(tweet.media?.photos?.map((photo) => photo.url)).toStrictEqual([
      "https://img/one.jpg",
      "https://img/two.jpg",
    ]);
  });

  test("leaves a quote source absent when its own identity is missing", async () => {
    const client = makeClient(() =>
      Response.json({
        id_str: "123",
        quoted_tweet: { text: "anonymous quote" },
        text: "container",
        user: { screen_name: "alice" },
      })
    );

    const tweet = await runWithClient(
      fetchSyndicationStatusEffect("alice", "123"),
      client
    );

    expect(tweet.quote?.url).toBeUndefined();
  });

  test("classifies non-2xx, non-JSON, malformed, empty, and network failures", async () => {
    const missingClient = makeClient(() => new Response("{}", { status: 404 }));
    await expect(
      runWithClient(fetchSyndicationStatusEffect("alice", "123"), missingClient)
    ).rejects.toMatchObject({ code: "syndication_error", status: 404 });

    const nonJsonClient = makeClient(() => new Response("not-json"));
    await expect(
      runWithClient(fetchSyndicationStatusEffect("alice", "123"), nonJsonClient)
    ).rejects.toMatchObject({ code: "syndication_error", status: 502 });

    const malformedClient = makeClient(() => Response.json({ text: 123 }));
    await expect(
      runWithClient(
        fetchSyndicationStatusEffect("alice", "123"),
        malformedClient
      )
    ).rejects.toMatchObject({
      _tag: "SyndicationSchemaError",
      code: "syndication_error",
      status: 502,
    });

    const emptyClient = makeClient(() => Response.json({ id_str: "123" }));
    await expect(
      runWithClient(fetchSyndicationStatusEffect("alice", "123"), emptyClient)
    ).rejects.toMatchObject({ code: "syndication_empty", status: 404 });

    await expect(
      runWithClient(
        fetchSyndicationStatusEffect("alice", "123"),
        networkFailureClient
      )
    ).rejects.toMatchObject({ code: "syndication_network", status: 502 });
  });
});
