import { describe, expect, test } from "vitest";

import type { FxTweet } from "@/lib/fxtwitter-types.ts";
import { renderThreadMarkdown } from "@/lib/markdown.ts";

const posts: FxTweet[] = [
  {
    author: { name: "Root", screen_name: "root" },
    created_at: "today",
    id: "1",
    likes: 12,
    media: {
      videos: [
        {
          bitrate: 2000,
          duration_ms: 1200,
          height: 1080,
          thumbnail_url: "https://img/thumb.jpg",
          type: "video",
          url: "https://video/high.mp4",
          variants: [
            {
              bitrate: 2000,
              content_type: "video/mp4",
              url: "https://video/high.mp4",
            },
            {
              bitrate: 500,
              content_type: "video/mp4",
              url: "https://video/low.mp4",
            },
          ],
          width: 1920,
        },
      ],
    },
    quote: {
      author: { name: "Quote", screen_name: "quote" },
      id: "9",
      text: "Quoted",
    },
    text: "Root post",
  },
  {
    author: { name: "Root", screen_name: "root" },
    id: "2",
    text: "Reply",
  },
];

describe("markdown output", () => {
  test("compact is the concise default shape while full retains metadata", () => {
    const compact = renderThreadMarkdown(posts, {
      canonicalUrl: "https://x.com/root/status/1",
      compact: true,
      format: "markdown",
      userinfo: "off",
    });
    const full = renderThreadMarkdown(posts, {
      canonicalUrl: "https://x.com/root/status/1",
      compact: false,
      format: "markdown",
      userinfo: "off",
    });
    expect(compact).not.toContain("Stats:");
    expect(full).toContain("Stats: 12 likes");
    expect(full).toContain("Date: today");
  });

  test("renders source URLs for every item and quote", () => {
    const output = renderThreadMarkdown(posts, {
      canonicalUrl: "https://x.com/root/status/1",
      compact: true,
      format: "markdown",
      userinfo: "off",
    });
    expect(output).toContain("https://x.com/root/status/1");
    expect(output).toContain("https://x.com/root/status/2");
    expect(output).toContain("https://x.com/quote/status/9");
  });

  test("renders complete video metadata including variants", () => {
    const output = renderThreadMarkdown(posts, {
      canonicalUrl: "https://x.com/root/status/1",
      compact: true,
      format: "markdown",
      userinfo: "off",
    });
    expect(output).toContain("[video](https://video/high.mp4)");
    expect(output).toContain("duration: 1200ms · 1920×1080 · 2000bps");
    expect(output).toContain("https://video/low.mp4");
  });

  test("renders typed relation labels in compact and full output", () => {
    const related = posts.map((post, index) => ({
      ...post,
      context: index === 0 ? ("post" as const) : ("reply" as const),
    }));
    const compact = renderThreadMarkdown(related, {
      canonicalUrl: "https://x.com/root/status/1",
      compact: true,
      format: "markdown",
      userinfo: "off",
    });
    const full = renderThreadMarkdown(related, {
      canonicalUrl: "https://x.com/root/status/1",
      compact: false,
      format: "markdown",
      userinfo: "off",
    });
    expect(compact).toContain("## Post · 1/2");
    expect(compact).toContain("## Reply · 2/2");
    expect(full).toContain("## Post · 1/2");
  });

  test("retains the post relation in single-post full and Obsidian output", () => {
    const single = [{ ...posts[0], context: "post" as const }];
    const full = renderThreadMarkdown(single, {
      canonicalUrl: "https://x.com/root/status/1",
      compact: false,
      format: "markdown",
      userinfo: "off",
    });
    const obsidian = renderThreadMarkdown(single, {
      canonicalUrl: "https://x.com/root/status/1",
      format: "obsidian",
      userinfo: "off",
    });
    expect(full).toContain("## Post · 1/1");
    expect(obsidian).toContain("## Post · 1/1");
    expect(obsidian).toContain("source: https://x.com/root/status/1");
    expect(obsidian).toContain("tags: [twitter, x, root]");
  });

  test("does not attribute an unidentified reply to the requested post URL", () => {
    const output = renderThreadMarkdown(
      [
        { ...posts[0], context: "post" },
        { context: "reply", text: "Identity missing" },
      ],
      {
        canonicalUrl: "https://x.com/root/status/1",
        compact: true,
        format: "markdown",
        userinfo: "off",
      }
    );

    expect(output).toContain("Source: Unavailable (post identity missing)");
    expect(output.match(/https:\/\/x\.com\/root\/status\/1/gu)).toHaveLength(1);
  });

  test("userinfo levels inject author blocks once per author", () => {
    const base = {
      canonicalUrl: "https://x.com/root/status/1",
      compact: true,
      format: "markdown" as const,
    };
    const off = renderThreadMarkdown(posts, { ...base, userinfo: "off" });
    const author = renderThreadMarkdown(posts, { ...base, userinfo: "author" });
    const all = renderThreadMarkdown(posts, { ...base, userinfo: "all" });
    expect(off).not.toContain("### Author");
    expect(author.match(/### Author/gu)).toHaveLength(1);
    expect(all.match(/### Author/gu)).toHaveLength(1);
  });
});
