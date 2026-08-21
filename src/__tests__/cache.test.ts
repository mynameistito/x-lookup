import { Effect } from "effect";
import type { Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vitest";

import type { MinimalCache } from "@/lib/cache-api-store.ts";
import {
  Cache,
  buildCacheKey,
  layerCacheApi,
  layerMemory,
  parseTtlSeconds,
} from "@/lib/cache.ts";
import type { CacheLookup } from "@/lib/cache.ts";

class FakeEdgeCache implements MinimalCache {
  readonly entries = new Map<string, string>();
  failReads = false;
  failWrites = false;

  match(key: string): Promise<Response | undefined> {
    if (this.failReads) {
      return Promise.reject(new Error("edge read failed"));
    }
    const body = this.entries.get(key);
    return Promise.resolve(
      body === undefined
        ? undefined
        : new Response(body, {
            headers: { "Content-Type": "application/json" },
          })
    );
  }

  async put(key: string, response: Response): Promise<void> {
    if (this.failWrites) {
      throw new Error("edge write failed");
    }
    this.entries.set(key, await response.text());
  }
}

const lookup = <A, E, R>(
  key: string,
  bypass: boolean,
  load: Effect.Effect<A, E, R>
): Effect.Effect<CacheLookup<A>, E, R | Cache> =>
  Cache.use((cache) => cache.getOrLoad(key, bypass, load));

const runWithCache = <A>(
  program: Effect.Effect<A, never, Cache>,
  layer: Layer.Layer<Cache>
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(Effect.provide(program, layer), TestClock.layer())
  );

const ttl = (seconds: number) => parseTtlSeconds(String(seconds));

describe("Cache service", () => {
  test("serves an L1 hit without re-running the loader", async () => {
    let calls = 0;
    const load = Effect.sync(() => {
      calls += 1;
      return 42;
    });
    const program = Effect.gen(function* l1Hit() {
      const first = yield* lookup("k", false, load);
      const second = yield* lookup("k", false, load);
      return { first, second };
    });

    const result = await runWithCache(program, layerMemory(ttl(60)));

    expect(result.first).toStrictEqual({ status: "miss", value: 42 });
    expect(result.second).toStrictEqual({ status: "hit", value: 42 });
    expect(calls).toBe(1);
  });

  test("serves an L2 hit and backfills L1", async () => {
    const edge = new FakeEdgeCache();
    await runWithCache(
      lookup("k", false, Effect.succeed("from-l2")),
      layerCacheApi(edge, ttl(60))
    );

    let loaderCalls = 0;
    const program = Effect.gen(function* l2Backfill() {
      const first = yield* lookup(
        "k",
        false,
        Effect.sync(() => {
          loaderCalls += 1;
          return "fresh";
        })
      );
      edge.failReads = true;
      const second = yield* lookup(
        "k",
        false,
        Effect.sync(() => {
          loaderCalls += 1;
          return "fresh";
        })
      );
      return { first, second };
    });

    const result = await runWithCache(program, layerCacheApi(edge, ttl(60)));

    expect(result.first).toStrictEqual({ status: "hit", value: "from-l2" });
    expect(result.second).toStrictEqual({ status: "hit", value: "from-l2" });
    expect(loaderCalls).toBe(0);
  });

  test("a miss writes every configured store", async () => {
    const edge = new FakeEdgeCache();
    const first = await runWithCache(
      lookup("written", false, Effect.succeed("value")),
      layerCacheApi(edge, ttl(60))
    );
    expect(first).toStrictEqual({ status: "miss", value: "value" });
    expect(edge.entries.size).toBe(1);

    let loaderCalls = 0;
    const second = await runWithCache(
      lookup(
        "written",
        false,
        Effect.sync(() => {
          loaderCalls += 1;
          return "fresh";
        })
      ),
      layerCacheApi(edge, ttl(60))
    );
    expect(second).toStrictEqual({ status: "hit", value: "value" });
    expect(loaderCalls).toBe(0);
  });

  test("bypass skips reads and writes", async () => {
    let calls = 0;
    const load = Effect.sync(() => {
      calls += 1;
      return "value";
    });
    const program = Effect.gen(function* bypassCache() {
      const bypassed = yield* lookup("k", true, load);
      const normal = yield* lookup("k", false, load);
      return { bypassed, normal };
    });

    const result = await runWithCache(program, layerMemory(ttl(60)));

    expect(result.bypassed).toStrictEqual({ status: "bypass", value: "value" });
    expect(result.normal).toStrictEqual({ status: "miss", value: "value" });
    expect(calls).toBe(2);
  });

  test("expires entries deterministically through TestClock", async () => {
    let calls = 0;
    const load = Effect.sync(() => {
      calls += 1;
      return calls;
    });
    const program = Effect.gen(function* expireCache() {
      const first = yield* lookup("k", false, load);
      yield* TestClock.adjust("60 seconds");
      const atBoundary = yield* lookup("k", false, load);
      yield* TestClock.adjust(1);
      const expired = yield* lookup("k", false, load);
      return { atBoundary, expired, first };
    });

    const result = await runWithCache(program, layerMemory(ttl(60)));

    expect(result.first).toStrictEqual({ status: "miss", value: 1 });
    expect(result.atBoundary).toStrictEqual({ status: "hit", value: 1 });
    expect(result.expired).toStrictEqual({ status: "miss", value: 2 });
  });

  test("L2 backfill keeps only the remaining TTL", async () => {
    const edge = new FakeEdgeCache();
    const program = Effect.gen(function* remainingTtl() {
      yield* Effect.provide(
        lookup("k", false, Effect.succeed("original")),
        layerCacheApi(edge, ttl(60))
      );
      yield* TestClock.adjust("30 seconds");

      return yield* Effect.provide(
        Effect.gen(function* freshL1() {
          const fromL2 = yield* lookup("k", false, Effect.succeed("fresh"));
          edge.failReads = true;
          yield* TestClock.adjust("30 seconds");
          yield* TestClock.adjust(1);
          const afterRemainingTtl = yield* lookup(
            "k",
            false,
            Effect.succeed("fresh")
          );
          return { afterRemainingTtl, fromL2 };
        }),
        layerCacheApi(edge, ttl(60))
      );
    });

    const result = await Effect.runPromise(
      Effect.provide(program, TestClock.layer())
    );

    expect(result.fromL2).toStrictEqual({ status: "hit", value: "original" });
    expect(result.afterRemainingTtl).toStrictEqual({
      status: "miss",
      value: "fresh",
    });
  });

  test("caps memory at 500 entries and refreshes recency on hit", async () => {
    const program = Effect.gen(function* memoryRecency() {
      for (let index = 0; index < 500; index += 1) {
        yield* lookup(`k${index}`, false, Effect.succeed(index));
      }

      const refreshed = yield* lookup("k0", false, Effect.succeed(-1));
      yield* lookup("k500", false, Effect.succeed(500));
      const evicted = yield* lookup("k1", false, Effect.succeed(1001));
      const retained = yield* lookup("k0", false, Effect.succeed(-1));
      return { evicted, refreshed, retained };
    });

    const result = await runWithCache(program, layerMemory(ttl(60)));

    expect(result.refreshed).toStrictEqual({ status: "hit", value: 0 });
    expect(result.evicted).toStrictEqual({ status: "miss", value: 1001 });
    expect(result.retained).toStrictEqual({ status: "hit", value: 0 });
  });

  test("treats a failing L2 read as best effort", async () => {
    const edge = new FakeEdgeCache();
    edge.failReads = true;
    const program = Effect.gen(function* failingRead() {
      const first = yield* lookup("k", false, Effect.succeed("value"));
      const second = yield* lookup("k", false, Effect.succeed("fresh"));
      return { first, second };
    });

    const result = await runWithCache(program, layerCacheApi(edge, ttl(60)));

    expect(result.first).toStrictEqual({ status: "miss", value: "value" });
    expect(result.second).toStrictEqual({ status: "hit", value: "value" });
  });

  test("treats a failing L2 write as best effort", async () => {
    const edge = new FakeEdgeCache();
    edge.failWrites = true;
    const program = Effect.gen(function* failingWrite() {
      const first = yield* lookup("k", false, Effect.succeed("value"));
      const second = yield* lookup("k", false, Effect.succeed("fresh"));
      return { first, second };
    });

    const result = await runWithCache(program, layerCacheApi(edge, ttl(60)));

    expect(result.first).toStrictEqual({ status: "miss", value: "value" });
    expect(result.second).toStrictEqual({ status: "hit", value: "value" });
    expect(edge.entries.size).toBe(0);
  });
});

describe("cache configuration", () => {
  test("buildCacheKey sorts entries deterministically", () => {
    expect(buildCacheKey({ a: 1, b: 2 })).toBe("a=1&b=2");
  });

  test.each([
    ["7200", 7200],
    [undefined, 3600],
    ["-5", 3600],
    ["abc", 3600],
    ["0", 3600],
    ["2.9", 2],
  ] as const)("parses TTL %s as %s seconds", (input, expected) => {
    expect(parseTtlSeconds(input)).toBe(expected);
  });

  test("the in-memory Layer uses the default TTL", async () => {
    let calls = 0;
    const load = Effect.sync(() => {
      calls += 1;
      return calls;
    });
    const program = Effect.gen(function* defaultTtl() {
      const first = yield* lookup("default", false, load);
      yield* TestClock.adjust("3600 seconds");
      const atBoundary = yield* lookup("default", false, load);
      yield* TestClock.adjust(1);
      const expired = yield* lookup("default", false, load);
      return { atBoundary, expired, first };
    });

    const result = await runWithCache(program, layerMemory());

    expect([
      result.first.status,
      result.atBoundary.status,
      result.expired.status,
    ]).toStrictEqual(["miss", "hit", "miss"]);
    expect(calls).toBe(2);
  });
});
