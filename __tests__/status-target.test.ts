import { Result } from "effect";
import { describe, expect, test } from "vitest";

import {
  parseStatusUrl,
  resolve,
  StatusUrlHostUnsupported,
  StatusUrlInvalid,
  StatusUrlPathInvalid,
  StatusTargetInvalid,
  StatusTargetMissing,
} from "@/lib/status-target.ts";

const succeedTarget = (
  result: ReturnType<typeof parseStatusUrl> | ReturnType<typeof resolve>
) => {
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

const failTarget = (
  result: ReturnType<typeof parseStatusUrl> | ReturnType<typeof resolve>
) => {
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

describe(parseStatusUrl, () => {
  test.each([
    "https://x.com/ada/status/123",
    "https://www.x.com/ada/status/123",
    "https://twitter.com/ada/status/123",
    "https://www.twitter.com/ada/status/123",
    "https://mobile.twitter.com/ada/status/123",
    "https://x-lookup.mynameistito.com/ada/status/123",
    "https://x-lookup.someone.workers.dev/ada/status/123",
    "http://localhost/ada/status/123",
    "http://127.0.0.1/ada/status/123",
    "https://x.com/ada/status/123/",
    "https://x.com/@ada/status/123",
  ])("accepts %s and canonicalizes the target", (raw) => {
    const target = succeedTarget(parseStatusUrl(raw));
    expect(target.id).toBe("123");
    expect(target.canonicalUrl).toBe(
      `https://x.com/${target.handle}/status/123`
    );
  });

  test("keeps the handle token verbatim, including a leading @", () => {
    expect(
      succeedTarget(parseStatusUrl("https://x.com/@ada/status/9")).handle
    ).toBe("@ada");
  });

  test("rejects text that is not a URL at all", () => {
    const failure = failTarget(parseStatusUrl("not a url"));
    expect(failure).toBeInstanceOf(StatusUrlInvalid);
    expect(failure).toMatchObject({
      _tag: "StatusUrlInvalid",
      code: "invalid_url",
      message: "Invalid URL. Provide a public X/Twitter status URL.",
      status: 400,
    });
  });

  test.each([
    "https://example.com/ada/status/123",
    "https://x.com.evil.test/ada/status/123",
    "https://fxtwitter.com/ada/status/123",
  ])("rejects unsupported hosts (%s)", (raw) => {
    const failure = failTarget(parseStatusUrl(raw));
    expect(failure).toBeInstanceOf(StatusUrlHostUnsupported);
    expect(failure).toMatchObject({
      _tag: "StatusUrlHostUnsupported",
      code: "unsupported_host",
      message: "Only x.com or twitter.com status URLs are supported.",
      status: 400,
    });
  });

  test.each([
    "https://x.com/ada",
    "https://x.com/ada/followers",
    "https://x.com/ada/status/",
    "https://x.com/ada/status/abc",
    "https://x.com//status/123",
  ])("rejects non-permalink paths (%s)", (raw) => {
    const failure = failTarget(parseStatusUrl(raw));
    expect(failure).toBeInstanceOf(StatusUrlPathInvalid);
    expect(failure).toMatchObject({
      _tag: "StatusUrlPathInvalid",
      code: "invalid_path",
      message:
        "URL must be a status permalink like https://x.com/handle/status/1234567890.",
      status: 400,
    });
  });
});

describe(resolve, () => {
  test("an explicit url wins over handle+id", () => {
    const target = succeedTarget(
      resolve({ handle: "bob", id: "9", url: "https://x.com/ada/status/123" })
    );
    expect(target.handle).toBe("ada");
    expect(target.id).toBe("123");
  });

  test("normalizes handle+id pairs like the historical query semantics", () => {
    const target = succeedTarget(resolve({ handle: "@Ada", id: "12a34" }));
    expect(target.handle).toBe("Ada");
    expect(target.id).toBe("1234");
    expect(target.canonicalUrl).toBe("https://x.com/Ada/status/1234");
  });

  test("keeps accepting lenient handle tokens for handle+id requests", () => {
    const target = succeedTarget(resolve({ handle: "!!!", id: "7" }));
    expect(target.handle).toBe("!!!");
    expect(target.id).toBe("7");
  });

  test("refuses pairs whose id has no digits at all", () => {
    const failure = failTarget(resolve({ handle: "ada", id: "abc" }));
    expect(failure).toBeInstanceOf(StatusTargetInvalid);
    expect(failure).toMatchObject({
      _tag: "StatusTargetInvalid",
      code: "invalid_params",
      message: "Missing or invalid handle/status id.",
      status: 400,
    });
  });

  test("refuses pairs whose handle empties out after de-@-ing", () => {
    const failure = failTarget(resolve({ handle: "@", id: "7" }));
    expect(failure).toMatchObject({ _tag: "StatusTargetInvalid" });
  });

  test.each([
    [{}, "neither url nor pair"],
    [{ handle: "ada" }, "handle only"],
    [{ id: "7" }, "id only"],
  ])("reports missing targets for %s", (input) => {
    const failure = failTarget(resolve(input));
    expect(failure).toBeInstanceOf(StatusTargetMissing);
    expect(failure).toMatchObject({
      _tag: "StatusTargetMissing",
      code: "missing_url",
      message: "Missing required `url` query parameter.",
      status: 400,
    });
  });
});
