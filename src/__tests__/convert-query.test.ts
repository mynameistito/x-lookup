import { Result } from "effect";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { convertTweet } from "../lib/converter.js";

const respond = <T>(url: string, body: T, status = 200): Promise<Response> => {
  if (!url.includes("api.fxtwitter.com")) {
    return Promise.reject(new Error(`unexpected upstream: ${url}`));
  }
  return Promise.resolve(Response.json(body, { status }));
};

const stubFxStatus = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn<(url: string) => Promise<Response>>((url) =>
      respond(url, { code: 200, status: { id: "42", text: "hello" } })
    )
  );
};

const succeed = async (input: Parameters<typeof convertTweet>[0]) => {
  const result = await convertTweet(input);
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

const failureOf = async (input: Parameters<typeof convertTweet>[0]) => {
  const result = await convertTweet(input);
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

const validUrl = "https://x.com/testuser/status/42";

describe("convert format parsing", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFxStatus();
  });

  test.each([undefined, null, "", "markdown", "obsidian", "json"] as const)(
    "accepts format=%s",
    async (format) => {
      const result = await succeed({ format, url: validUrl });
      expect(["markdown", "obsidian", "json"]).toContain(result.format);
    }
  );

  test("defaults to markdown when the parameter is absent or empty", async () => {
    const absent = await succeed({ url: validUrl });
    expect(absent.format).toBe("markdown");
    const empty = await succeed({ format: "", url: validUrl });
    expect(empty.format).toBe("markdown");
  });

  test("refuses unsupported formats with the historical contract", async () => {
    const failure = await failureOf({ format: "rss", url: validUrl });
    expect(failure).toMatchObject({
      _tag: "InvalidOutputFormat",
      code: "invalid_format",
      input: "rss",
      message: "`format` must be `markdown`, `obsidian`, or `json`.",
      status: 400,
    });
  });
});

describe("convert userinfo/context/replies parsing", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFxStatus();
  });

  test.each([undefined, "", "off", "author", "all"] as const)(
    "accepts userinfo=%s",
    async (userinfo) => {
      await expect(succeed({ url: validUrl, userinfo })).resolves.toBeDefined();
    }
  );

  test("refuses unsupported userinfo levels", async () => {
    const failure = await failureOf({ url: validUrl, userinfo: "both" });
    expect(failure).toMatchObject({
      _tag: "InvalidUserinfo",
      code: "invalid_userinfo",
      message: "`userinfo` must be `off`, `author`, or `all`.",
      status: 400,
    });
  });

  test.each([undefined, "", "full", "thread"] as const)(
    "accepts context=%s",
    async (context) => {
      await expect(succeed({ context, url: validUrl })).resolves.toBeDefined();
    }
  );

  test("refuses unsupported context modes", async () => {
    const failure = await failureOf({ context: "conversation", url: validUrl });
    expect(failure).toMatchObject({
      _tag: "InvalidContext",
      code: "invalid_context",
      message: "`context` must be `full` or `thread`.",
      status: 400,
    });
  });

  test.each([undefined, "", "top", "recent", "off"] as const)(
    "accepts replies=%s",
    async (replies) => {
      await expect(succeed({ replies, url: validUrl })).resolves.toBeDefined();
    }
  );

  test("refuses unsupported replies modes", async () => {
    const failure = await failureOf({ replies: "all", url: validUrl });
    expect(failure).toMatchObject({
      _tag: "InvalidReplies",
      code: "invalid_replies",
      message: "`replies` must be `top`, `recent`, or `off`.",
      status: 400,
    });
  });
});

describe("convert boolean flag semantics", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFxStatus();
  });

  test.each(["1", "true", "yes"] as const)(
    "nocache=%s bypasses the cache (convert aliases)",
    async (nocache) => {
      const first = await succeed({ nocache, url: validUrl });
      expect(first.cache).toBe("bypass");
    }
  );

  test.each(["0", "false", "junk", ""] as const)(
    "nocache=%s keeps caching enabled",
    async (nocache) => {
      const first = await succeed({ nocache, url: validUrl });
      expect(first.cache).not.toBe("bypass");
    }
  );

  test("full=yes restores rich rendering on convert endpoints", async () => {
    const rich = await succeed({ full: "yes", url: validUrl });
    expect(rich.compact).toBeFalsy();
    const compact = await succeed({ full: "nope", url: validUrl });
    expect(compact.compact).toBeTruthy();
  });
});

describe("convert target via handle+id parameters", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFxStatus();
  });

  test("resolves @-prefixed handles and digit-bearing ids", async () => {
    const result = await succeed({ handle: "@Ada", id: "12a34" });
    expect(result.canonicalUrl).toBe("https://x.com/Ada/status/1234");
  });

  test("refuses pairs without a usable id", async () => {
    const failure = await failureOf({ handle: "ada", id: "none" });
    expect(failure).toMatchObject({
      code: "invalid_params",
      status: 400,
    });
  });
});

describe("convert parse-error precedence", () => {
  test("format is parsed before the thread value", async () => {
    const failure = await failureOf({
      format: "rss",
      thread: "bad",
      url: validUrl,
    });
    expect(failure).toMatchObject({ _tag: "InvalidOutputFormat" });
  });

  test("thread is parsed before userinfo, context, replies, and the target", async () => {
    const failure = await failureOf({
      context: "bad",
      replies: "bad",
      thread: "bad",
      userinfo: "bad",
    });
    expect(failure).toMatchObject({ _tag: "InvalidThread" });
  });

  test("userinfo is parsed before context", async () => {
    const failure = await failureOf({ context: "bad", userinfo: "bad" });
    expect(failure).toMatchObject({ _tag: "InvalidUserinfo" });
  });

  test("context is parsed before replies", async () => {
    const failure = await failureOf({ context: "bad", replies: "bad" });
    expect(failure).toMatchObject({ _tag: "InvalidContext" });
  });

  test("the target is resolved last", async () => {
    const failure = await failureOf({ replies: "bad" });
    expect(failure).toMatchObject({ _tag: "InvalidReplies" });
    const missing = await failureOf({});
    expect(missing).toMatchObject({ _tag: "StatusTargetMissing" });
  });
});
