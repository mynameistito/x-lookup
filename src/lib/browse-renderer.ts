import { DEFAULT_LIMIT } from "@/lib/browse-query.ts";
import type { BrowseRequest, BrowseResult } from "@/lib/browse.ts";
import type { FxAuthor, FxTweet } from "@/lib/fxtwitter-types.ts";

const postLine = (post: FxTweet, full: boolean): string => {
  const handle = post.author?.screen_name ?? "unknown";
  const profileUrl = `https://x.com/${handle}`;
  const url =
    post.url ??
    (post.id ? `https://x.com/${handle}/status/${post.id}` : profileUrl);
  const text = (post.text ?? "").replaceAll(/\s+/gu, " ").trim();
  const likes = post.likes ?? 0;
  const reposts = post.retweets ?? 0;
  const replies = post.replies ?? 0;
  const metrics = full
    ? ` — ${likes} likes, ${reposts} reposts, ${replies} replies`
    : "";
  const date = full && post.created_at ? ` (${post.created_at})` : "";
  return `- [@${handle}](${profileUrl}): ${text}${date}${metrics} [Source](${url})`;
};

const userLine = (user: FxAuthor, full: boolean): string => {
  const handle = user.screen_name ?? "unknown";
  const bio = user.description
    ? ` — ${user.description.replaceAll(/\s+/gu, " ")}`
    : "";
  const details = full ? ` — ${user.followers ?? 0} followers${bio}` : "";
  const displayName = user.name ?? `@${handle}`;
  return `- [${displayName} (@${handle})](https://x.com/${handle})${details}`;
};

const continuation = (
  request: BrowseRequest,
  result: BrowseResult
): string | undefined => {
  if (!result.nextCursor) {
    return undefined;
  }
  const controls = new URLSearchParams();
  if (result.limit !== DEFAULT_LIMIT) {
    controls.set("limit", String(result.limit));
  }
  if (request.full) {
    controls.set("full", "true");
  }
  if (request.formatParam) {
    controls.set("format", request.formatParam);
  }
  let path: string;
  if (result.resource === "search") {
    controls.set("q", result.query ?? "");
    if (result.feed) {
      controls.set("feed", result.feed);
    }
    path = "/search";
  } else {
    const suffix = result.resource === "profile" ? "" : `/${result.resource}`;
    path = `/${result.handle}${suffix}`;
  }
  const cursorParams = new URLSearchParams(controls);
  cursorParams.set("cursor", result.nextCursor);
  const pageParams = new URLSearchParams(controls);
  pageParams.set("page", String(result.page + 1));
  return `[Continue →](${path}?${cursorParams.toString()}) · [Next page (${result.page + 1}) →](${path}?${pageParams.toString()})`;
};

/** Render a browse result as its public Markdown representation. */
export const renderBrowseMarkdown = (
  request: BrowseRequest,
  result: BrowseResult
): string => {
  const lines: string[] = [];
  if (result.resource === "profile" && result.profile) {
    const { profile } = result;
    const handle = profile.screen_name ?? result.handle ?? "unknown";
    const displayName = profile.name ?? `@${handle}`;
    lines.push(`# [${displayName} (@${handle})](https://x.com/${handle})`, "");
    if (profile.description) {
      lines.push(profile.description, "");
    }
    if (request.full) {
      lines.push(
        `Followers: ${profile.followers ?? 0} · Following: ${profile.following ?? 0} · Posts: ${profile.statuses ?? 0}`,
        ""
      );
    }
    lines.push(
      "## Latest posts",
      ...(result.posts ?? []).map((post) => postLine(post, request.full))
    );
  } else if (result.resource === "search") {
    lines.push(
      `# X search: ${result.query}`,
      "",
      ...(result.posts ?? []).map((post) => postLine(post, request.full))
    );
  } else {
    lines.push(
      `# @${result.handle} ${result.resource}`,
      "",
      ...(result.users ?? []).map((user) => userLine(user, request.full))
    );
  }
  const next = continuation(request, result);
  if (next) {
    lines.push("", next);
  }
  return `${lines.join("\n").trim()}\n`;
};
