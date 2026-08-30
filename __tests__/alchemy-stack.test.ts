import { inMemoryState } from "alchemy";
import { providers } from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import { Stage } from "alchemy/Stage";
import { run } from "alchemy/Test/Core";
import { isEffect, provide } from "effect/Effect";
import { provideMerge, succeed } from "effect/Layer";
import { describe, expect, expectTypeOf, test } from "vitest";

import XLookupStack, {
  buildXLookupStack,
  makeXLookupWorker,
  resolveWorkerIdentity,
} from "@/alchemy.run.ts";
import type { XLookupEnv } from "@/alchemy.run.ts";
import WorkerEntrypoint from "@/worker.ts";

describe("alchemy stack", () => {
  test("exports a well-formed stack program", () => {
    expect(isEffect(XLookupStack)).toBeTruthy();
  });

  test("declares the x-lookup worker resource per stage", () => {
    expect(isEffect(makeXLookupWorker("prod"))).toBeTruthy();
    expect(isEffect(makeXLookupWorker("pr-7"))).toBeTruthy();
  });

  test("exports the runtime fetch handler", () => {
    expect(WorkerEntrypoint.fetch).toBeTypeOf("function");
  });

  test("serves requests through the runtime fetch handler", async () => {
    const response = await WorkerEntrypoint.fetch(
      new Request("https://x-lookup.mynameistito.com/"),
      { CACHE_TTL_SECONDS: "3600" }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
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
      providers: providers(),
      stage: "test",
      state: inMemoryState(),
    };
    const program = buildXLookupStack.pipe(
      provide(options.providers.pipe(provideMerge(succeed(Stack, stackSpec)))),
      provide(succeed(Stage, "test"))
    );

    const output = await run(program, options);

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
      workersDev: false,
    });
  });

  test("derives an isolated identity for local dev and PR preview stages", () => {
    expect(resolveWorkerIdentity("pr-7")).toStrictEqual({
      name: "x-lookup-pr-7",
      workersDev: true,
    });
    expect(resolveWorkerIdentity("dev_mynameistito")).toStrictEqual({
      name: "x-lookup-dev_mynameistito",
      workersDev: true,
    });
    expect(resolveWorkerIdentity("test")).toStrictEqual({
      name: "x-lookup-test",
      workersDev: true,
    });
  });
});
