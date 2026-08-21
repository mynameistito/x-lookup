// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import is the documented Alchemy stack style; inMemoryState lives on the module namespace.
import * as Alchemy from "alchemy";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import matches the stack under test; providers() lives on the Cloudflare namespace.
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import { Stage } from "alchemy/Stage";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import keeps the test-harness runtime addressable under one name.
import * as Core from "alchemy/Test/Core";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import matches Effect's recommended style.
import * as Effect from "effect/Effect";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- SAFETY: namespace import matches Effect's recommended style.
import * as Layer from "effect/Layer";
import { describe, expect, expectTypeOf, test } from "vitest";

import XLookupStack, {
  buildXLookupStack,
  makeXLookupWorker,
} from "@/alchemy.run.ts";
import type { XLookupEnv } from "@/alchemy.run.ts";
import { resolveWorkerIdentity } from "@/worker.ts";

describe("alchemy stack", () => {
  test("exports a well-formed stack program", () => {
    expect(Effect.isEffect(XLookupStack)).toBeTruthy();
  });

  test("declares the x-lookup worker resource per stage", () => {
    expect(Effect.isEffect(makeXLookupWorker("prod"))).toBeTruthy();
    expect(Effect.isEffect(makeXLookupWorker("pr-7"))).toBeTruthy();
  });

  test("executes the stack body against in-memory state without credentials", async () => {
    const stackSpec = {
      actions: {},
      bindings: {},
      name: "x-lookup",
      resources: {},
      stage: "test",
    };
    const options = {
      providers: Cloudflare.providers(),
      stage: "test",
      state: Alchemy.inMemoryState(),
    };
    const program = buildXLookupStack.pipe(
      Effect.provide(
        options.providers.pipe(
          Layer.provideMerge(Layer.succeed(Stack, stackSpec))
        )
      ),
      Effect.provide(Layer.succeed(Stage, "test"))
    );

    const output = await Core.run(program, options);

    expect(Object.keys(stackSpec.resources)).toStrictEqual(["x-lookup"]);
    expect(Object.keys(output)).toStrictEqual(["url"]);
    expect(output.url).toBeDefined();
  });

  test("derives the runtime env contract from the declared vars", () => {
    expectTypeOf<XLookupEnv>().toEqualTypeOf<{
      CACHE_TTL_SECONDS: string;
    }>();
  });
});

describe(resolveWorkerIdentity, () => {
  test("pins the production script name and custom domain only in prod", () => {
    expect(resolveWorkerIdentity("prod")).toStrictEqual({
      domain: "x-lookup.mynameistito.com",
      name: "x-lookup",
    });
  });

  test("derives an isolated identity for local dev and PR preview stages", () => {
    expect(resolveWorkerIdentity("pr-7")).toStrictEqual({
      name: "x-lookup-pr-7",
    });
    expect(resolveWorkerIdentity("dev_mynameistito")).toStrictEqual({
      name: "x-lookup-dev_mynameistito",
    });
    expect(resolveWorkerIdentity("test")).toStrictEqual({
      name: "x-lookup-test",
    });
  });
});
