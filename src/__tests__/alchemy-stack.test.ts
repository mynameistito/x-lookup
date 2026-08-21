import { isEffect } from "effect/Effect";
import { describe, expect, expectTypeOf, test } from "vitest";

import XLookupStack, { XLookupWorker } from "../../alchemy.run.js";
import type { XLookupEnv } from "../../alchemy.run.js";

describe("alchemy stack", () => {
  test("exports a well-formed stack program", () => {
    expect(isEffect(XLookupStack)).toBeTruthy();
  });

  test("declares the x-lookup worker resource", () => {
    expect(isEffect(XLookupWorker)).toBeTruthy();
  });

  test("derives the runtime env contract from the declared vars", () => {
    expectTypeOf<XLookupEnv>().toEqualTypeOf<{
      CACHE_TTL_SECONDS: string;
    }>();
  });
});
