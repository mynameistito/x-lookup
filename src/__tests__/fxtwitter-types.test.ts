import { describe, expect, test } from "vitest";

import { getParentStatusId } from "@/lib/fxtwitter-types.ts";
import type { FxTweet } from "@/lib/fxtwitter-types.ts";

const makeTweet = (id: string, overrides: Partial<FxTweet> = {}): FxTweet => ({
  id,
  text: `tweet ${id}`,
  ...overrides,
});

describe(getParentStatusId, () => {
  test("returns status from object replying_to", () => {
    const tweet = makeTweet("200", {
      replying_to: {
        screen_name: "alice",
        status: "100",
        url: "https://x.com/alice/status/100",
      },
    });
    expect(getParentStatusId(tweet)).toBe("100");
  });

  test("skips array replying_to and falls back to replying_to_status", () => {
    const tweet = makeTweet("200", {
      replying_to: ["alice"],
      replying_to_status: ["100"],
    });
    expect(getParentStatusId(tweet)).toBe("100");
  });

  test("returns replying_to_status[0] when replying_to is null or undefined", () => {
    expect(
      getParentStatusId(
        makeTweet("200", { replying_to: null, replying_to_status: ["100"] })
      )
    ).toBe("100");
    expect(
      getParentStatusId(makeTweet("200", { replying_to_status: ["100"] }))
    ).toBe("100");
  });

  test("returns undefined when parent identity is absent", () => {
    expect(getParentStatusId(makeTweet("100"))).toBeUndefined();
    expect(
      getParentStatusId(
        makeTweet("200", { replying_to: { screen_name: "alice" } })
      )
    ).toBeUndefined();
    expect(
      getParentStatusId(
        makeTweet("200", { replying_to: [], replying_to_status: null })
      )
    ).toBeUndefined();
  });

  test("prefers object replying_to.status and coerces to string", () => {
    const tweet = makeTweet("300", {
      replying_to: { status: "200" },
      replying_to_status: ["999"],
    });
    expect(getParentStatusId(tweet)).toBe("200");
    expect(getParentStatusId(tweet)).toBeTypeOf("string");
  });
});
