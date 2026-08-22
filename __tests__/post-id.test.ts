import { Option } from "effect";
import { describe, expect, test } from "vitest";

import { digitsOf, parse } from "@/domain/post-id.ts";

describe(parse, () => {
  test.each([
    ["123", "123"],
    ["0", "0"],
    ["9".repeat(20), "9".repeat(20)],
  ])("accepts the digit string %s", (raw, expected) => {
    expect(Option.getOrThrow(parse(raw))).toBe(expected);
  });

  test.each(["12a", "", " 1", "1.5", "-7"])("refuses %s", (raw) => {
    expect(Option.isNone(parse(raw))).toBeTruthy();
  });
});

describe(digitsOf, () => {
  test("keeps only the digit characters", () => {
    expect(Option.getOrThrow(digitsOf("12a34"))).toBe("1234");
    expect(Option.getOrThrow(digitsOf(" 9 "))).toBe("9");
    expect(Option.getOrThrow(digitsOf("7-7"))).toBe("77");
  });

  test("yields none when no digits remain", () => {
    expect(Option.isNone(digitsOf("abc"))).toBeTruthy();
    expect(Option.isNone(digitsOf(""))).toBeTruthy();
    expect(Option.isNone(digitsOf("@!"))).toBeTruthy();
  });
});
