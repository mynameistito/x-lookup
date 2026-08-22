import { Result } from "effect";
import { describe, expect, test } from "vitest";

import { parseConvertRequest } from "@/lib/converter.ts";
import type { ConvertInput, ConvertRequest } from "@/lib/converter.ts";

const succeed = (input: ConvertInput): ConvertRequest => {
  const result = parseConvertRequest(input);
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

const failureOf = (input: ConvertInput) => {
  const result = parseConvertRequest(input);
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

const validUrl = "https://x.com/testuser/status/42";

describe("convert format parsing", () => {
  test.each([undefined, null, "", "markdown", "obsidian", "json"] as const)(
    "accepts format=%s",
    (format) => {
      const result = succeed({ format, url: validUrl });
      expect(["markdown", "obsidian", "json"]).toContain(result.format);
    }
  );

  test("defaults to markdown when the parameter is absent or empty", () => {
    const absent = succeed({ url: validUrl });
    const empty = succeed({ format: "", url: validUrl });
    expect({ absent: absent.format, empty: empty.format }).toStrictEqual({
      absent: "markdown",
      empty: "markdown",
    });
  });

  test("refuses unsupported formats with the historical contract", () => {
    const failure = failureOf({ format: "rss", url: validUrl });
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
  test.each([undefined, "", "off", "author", "all"] as const)(
    "accepts userinfo=%s",
    (userinfo) => {
      const result = succeed({ url: validUrl, userinfo });
      expect(result.userinfo).toBeDefined();
    }
  );

  test("refuses unsupported userinfo levels", () => {
    const failure = failureOf({ url: validUrl, userinfo: "both" });
    expect(failure).toMatchObject({
      _tag: "InvalidUserinfo",
      code: "invalid_userinfo",
      message: "`userinfo` must be `off`, `author`, or `all`.",
      status: 400,
    });
  });

  test.each([undefined, "", "full", "thread"] as const)(
    "accepts context=%s",
    (context) => {
      const result = succeed({ context, url: validUrl });
      expect(result.context).toBeDefined();
    }
  );

  test("refuses unsupported context modes", () => {
    const failure = failureOf({ context: "conversation", url: validUrl });
    expect(failure).toMatchObject({
      _tag: "InvalidContext",
      code: "invalid_context",
      message: "`context` must be `full` or `thread`.",
      status: 400,
    });
  });

  test.each([undefined, "", "top", "recent", "off"] as const)(
    "accepts replies=%s",
    (replies) => {
      const result = succeed({ replies, url: validUrl });
      expect(result.replies).toBeDefined();
    }
  );

  test("refuses unsupported replies modes", () => {
    const failure = failureOf({ replies: "all", url: validUrl });
    expect(failure).toMatchObject({
      _tag: "InvalidReplies",
      code: "invalid_replies",
      message: "`replies` must be `top`, `recent`, or `off`.",
      status: 400,
    });
  });
});

describe("convert boolean flag semantics", () => {
  test.each(["1", "true", "yes"] as const)(
    "nocache=%s bypasses the cache (convert aliases)",
    (nocache) => {
      const result = succeed({ nocache, url: validUrl });
      expect(result.nocache).toBeTruthy();
    }
  );

  test.each(["0", "false", "junk", ""] as const)(
    "nocache=%s keeps caching enabled",
    (nocache) => {
      const result = succeed({ nocache, url: validUrl });
      expect(result.nocache).toBeFalsy();
    }
  );

  test("full=yes restores rich rendering on convert endpoints", () => {
    const rich = succeed({ full: "yes", url: validUrl });
    const compact = succeed({ full: "nope", url: validUrl });
    expect({ compact: compact.compact, rich: rich.compact }).toStrictEqual({
      compact: true,
      rich: false,
    });
  });
});

describe("convert target via handle+id parameters", () => {
  test("resolves @-prefixed handles and digit-bearing ids", () => {
    const result = succeed({ handle: "@Ada", id: "12a34" });
    expect(result.target.canonicalUrl).toBe("https://x.com/Ada/status/1234");
  });

  test("refuses pairs without a usable id", () => {
    const failure = failureOf({ handle: "ada", id: "none" });
    expect(failure).toMatchObject({
      code: "invalid_params",
      status: 400,
    });
  });
});

describe("convert parse-error precedence", () => {
  test("format is parsed before the thread value", () => {
    const failure = failureOf({
      format: "rss",
      thread: "bad",
      url: validUrl,
    });
    expect(failure).toMatchObject({ _tag: "InvalidOutputFormat" });
  });

  test("thread is parsed before userinfo, context, replies, and the target", () => {
    const failure = failureOf({
      context: "bad",
      replies: "bad",
      thread: "bad",
      userinfo: "bad",
    });
    expect(failure).toMatchObject({ _tag: "InvalidThread" });
  });

  test("userinfo is parsed before context", () => {
    const failure = failureOf({ context: "bad", userinfo: "bad" });
    expect(failure).toMatchObject({ _tag: "InvalidUserinfo" });
  });

  test("context is parsed before replies", () => {
    const failure = failureOf({ context: "bad", replies: "bad" });
    expect(failure).toMatchObject({ _tag: "InvalidContext" });
  });

  test("the target is resolved last", () => {
    const invalidReplies = failureOf({ replies: "bad" });
    const missing = failureOf({});
    expect({ invalidReplies, missing }).toMatchObject({
      invalidReplies: { _tag: "InvalidReplies" },
      missing: { _tag: "StatusTargetMissing" },
    });
  });
});
