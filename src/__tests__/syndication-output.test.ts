import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchSyndicationStatus } from "../lib/syndication.js";

describe("syndication video mapping", () => {
  afterEach(() => vi.restoreAllMocks());

  test("retains dimensions, duration, best direct URL, and every MP4 variant", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
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
                    url: "https://video/low.mp4",
                    content_type: "video/mp4",
                    bitrate: 256000,
                  },
                  {
                    url: "https://video/high.mp4",
                    content_type: "video/mp4",
                    bitrate: 832000,
                  },
                  {
                    url: "https://video/stream.m3u8",
                    content_type: "application/x-mpegURL",
                  },
                ],
              },
            },
          ],
          text: "video",
          user: { screen_name: "alice" },
        }),
        { status: 200 }
      )
    );

    const tweet = await fetchSyndicationStatus("alice", "123");
    expect(tweet.media?.videos?.[0]).toMatchObject({
      bitrate: 832_000,
      duration_ms: 4500,
      height: 720,
      thumbnail_url: "https://img/thumb.jpg",
      url: "https://video/high.mp4",
      width: 1280,
    });
    expect(
      tweet.media?.videos?.[0]?.variants?.map((variant) => variant.url)
    ).toStrictEqual(["https://video/high.mp4", "https://video/low.mp4"]);
  });

  test("uses actual quoted_tweet identity and does not duplicate overlapping media", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id_str: "123",
          mediaDetails: [
            { media_url_https: "https://img/one.jpg", type: "photo" },
          ],
          photos: [{ media_url_https: "https://img/one.jpg", type: "photo" }],
          quoted_tweet: {
            id_str: "456",
            text: "quote",
            user: { screen_name: "bob" },
          },
          text: "container",
          user: { screen_name: "alice" },
        }),
        { status: 200 }
      )
    );
    const tweet = await fetchSyndicationStatus("alice", "123");
    expect(tweet.media?.photos).toHaveLength(1);
    expect(tweet.quote).toMatchObject({
      id: "456",
      url: "https://x.com/bob/status/456",
    });
  });

  test("leaves a quote source absent when its own identity is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id_str: "123",
          quoted_tweet: { text: "anonymous quote" },
          text: "container",
          user: { screen_name: "alice" },
        }),
        { status: 200 }
      )
    );
    const tweet = await fetchSyndicationStatus("alice", "123");
    expect(tweet.quote?.url).toBeUndefined();
  });

  test("deduplicates overlapping fallback media projections", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        { status: 200 }
      )
    );

    const tweet = await fetchSyndicationStatus("alice", "123");
    expect(tweet.media?.photos?.map((photo) => photo.url)).toStrictEqual([
      "https://img/one.jpg",
      "https://img/two.jpg",
    ]);
  });

  test("maps user fields and reports truthful failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id_str: "123",
          text: "hi",
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
            profile_image_url_https: "https://img/avatar.jpg",
            screen_name: "alice",
            statuses_count: 30,
          },
        }),
        { status: 200 }
      )
    );
    const tweet = await fetchSyndicationStatus("alice", "123");
    expect(tweet.author).toMatchObject({
      followers: 10,
      following: 20,
      name: "Alice",
      screen_name: "alice",
      statuses: 30,
      website: { display_url: "alice.dev" },
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(fetchSyndicationStatus("alice", "123")).rejects.toMatchObject({
      code: "syndication_network",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 404 })
    );
    await expect(fetchSyndicationStatus("alice", "123")).rejects.toMatchObject({
      status: 404,
    });
  });
});
