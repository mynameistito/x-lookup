import { Result } from "effect";
import { describe, expect, test } from "vitest";

import type { InvalidXHandle } from "@/lib/x-handle.ts";
import { parse } from "@/lib/x-handle.ts";

const succeedHandle = (raw: string): string => {
  const result = parse(raw);
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

const failHandle = (raw: string): InvalidXHandle => {
  const result = parse(raw);
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

describe(parse, () => {
  test.each([
    ["ada", "ada"],
    ["@ada", "ada"],
    ["Ada_9", "Ada_9"],
    ["abcdefghijklmno", "abcdefghijklmno"],
    ["0", "0"],
  ])("accepts %s as %s", (raw, expected) => {
    expect(succeedHandle(raw)).toBe(expected);
  });

  test.each(["abcdefghijklmnop", "ada!", "", "@", "has space", "ada@"])(
    "refuses %s",
    (raw) => {
      const failure = failHandle(raw);
      expect(failure).toMatchObject({
        _tag: "InvalidXHandle",
        code: "invalid_handle",
        message: "A valid X handle is required.",
        status: 400,
      });
    }
  );
});
