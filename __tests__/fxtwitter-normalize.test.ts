import { describe, expect, test } from "vitest";

import {
  normalizeMediaItem,
  normalizeRepostedBy,
  normalizeTweet,
} from "@/providers/fxtwitter/normalize.ts";

describe("FxTwitter normalization", () => {
  test("derives media duration and variants from transport formats", () => {
    const media = normalizeMediaItem({
      duration: 4.5,
      formats: [
        {
          bitrate: 832_000,
          codec: "avc1",
          container: "mp4",
          url: "https://video/high.mp4",
        },
      ],
      type: "video",
    });

    expect(media).toMatchObject({
      duration_ms: 4500,
      variants: [
        {
          bitrate: 832_000,
          content_type: "video/mp4",
          url: "https://video/high.mp4",
        },
      ],
    });
  });

  test("preserves repost and parent fallback normalization", () => {
    const tweet = normalizeTweet({
      id: "200",
      replying_to: ["alice"],
      replying_to_status: ["100"],
      reposted_by: "alice",
      reposts: 7,
    });

    expect(tweet).toMatchObject({
      replying_to: ["alice"],
      replying_to_status: ["100"],
      reposted_by: { screen_name: "alice" },
      retweets: 7,
    });
  });

  test("normalizes null repost authors without changing their meaning", () => {
    expect(normalizeRepostedBy(null)).toBeNull();
    expect(normalizeRepostedBy()).toBeUndefined();
  });
});
