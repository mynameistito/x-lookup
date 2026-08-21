import { describe, expect, test } from "vitest";

import { CacheApiStore, MemoryStore, buildCacheKey, memoryConfig, parseTtlSeconds, withCache } from '../lib/cache.js';
import type { CacheStore, RuntimeConfig } from '../lib/cache.js';

class FakeEdgeCache {
  private readonly store = new Map<string, string>();

  async match(key: string): Promise<Response | undefined> {
    const body = this.store.get(key);
    return body === undefined
      ? undefined
      : new Response(body, { headers: { "Content-Type": "application/json" } });
  }

  async put(key: string, response: Response): Promise<void> {
    this.store.set(key, await response.text());
  }

  get size(): number {
    return this.store.size;
  }
}

describe(MemoryStore, () => {
  test("round-trips values and isolates instances with explicit maps", async () => {
    const map = new Map();
    const store = new MemoryStore(map);
    await store.set("k", { a: 1 }, 60);
    await expect(store.get("k")).resolves.toMatchObject({ value: { a: 1 } });
    await expect(new MemoryStore(new Map()).get("k")).resolves.toBeUndefined();
  });

  test("expires entries once their TTL elapses", async () => {
    const store = new MemoryStore(new Map());
    await store.set("gone", "value", -1);
    await expect(store.get("gone")).resolves.toBeUndefined();
    await store.set("alive", "value", 60);
    expect((await store.get("alive"))?.value).toBe("value");
  });

  test("caps entries at 500 with oldest-first eviction", async () => {
    const store = new MemoryStore(new Map());
    for (let index = 0; index < 505; index += 1) {
      await store.set(`k${index}`, index, 60);
    }
    await expect(store.get("k0")).resolves.toBeUndefined();
    expect((await store.get("k504"))?.value).toBe(504);
  });
});

describe(CacheApiStore, () => {
  test("round-trips envelopes through a Cache-API-shaped backend", async () => {
    const edge = new FakeEdgeCache();
    const store = new CacheApiStore(edge);
    await store.set("key", { hello: "world" }, 60);
    expect(edge.size).toBe(1);
    const entry = await store.get<{ hello: string }>("key");
    expect(entry?.value).toStrictEqual({ hello: "world" });
    expect(entry?.expiresAt).toBeGreaterThan(Date.now());
  });

  test("returns undefined for missing keys and refuses expired envelopes", async () => {
    const edge = new FakeEdgeCache();
    const store = new CacheApiStore(edge);
    await expect(store.get("missing")).resolves.toBeUndefined();

    await store.set("stale", "v", -1);
    await expect(store.get("stale")).resolves.toBeUndefined();
  });

  test("hashes keys so identical inputs reuse the same edge entry", async () => {
    const edge = new FakeEdgeCache();
    const store = new CacheApiStore(edge);
    await store.set("same", 1, 60);
    await store.set("same", 2, 60);
    expect(edge.size).toBe(1);
    expect((await store.get<number>("same"))?.value).toBe(2);
  });

  test("survives a failing backend without throwing", async () => {
    const broken = {
      match: async () => {
        throw new Error("edge down");
      },
      put: async () => {
        throw new Error("edge down");
      },
    };
    const store = new CacheApiStore(broken);
    await expect(store.set("k", "v", 60)).resolves.toBeUndefined();
    await expect(store.get("k")).resolves.toBeUndefined();
  });
});

describe("withCache composition", () => {
  function layered(): {
    config: RuntimeConfig;
    l1: MemoryStore;
    l2: MemoryStore;
  } {
    const l1 = new MemoryStore(new Map());
    const l2 = new MemoryStore(new Map());
    const config: RuntimeConfig = { stores: [l1, l2], ttlSeconds: 60 };
    return { config, l1, l2 };
  }

  test("misses populate every layer, then hits come from L1", async () => {
    const { config } = layered();
    let calls = 0;
    const load = async (): Promise<number> => {
      calls += 1;
      return 42;
    };

    const first = await withCache("k", false, load, config);
    expect(first).toStrictEqual({ status: "miss", value: 42 });
    const second = await withCache("k", false, load, config);
    expect(second).toStrictEqual({ status: "hit", value: 42 });
    expect(calls).toBe(1);
  });

  test("an L2 hit backfills L1 and reports a hit", async () => {
    const { config, l1, l2 } = layered();
    await l2.set("k", "from-l2", 60);
    await expect(l1.get("k")).resolves.toBeUndefined();

    const result = await withCache("k", false, async () => "fresh", config);
    expect(result).toStrictEqual({ status: "hit", value: "from-l2" });
    expect((await l1.get("k"))?.value).toBe("from-l2");
  });

  test("bypass skips reads and writes entirely", async () => {
    const { config, l1, l2 } = layered();
    let calls = 0;
    const load = async (): Promise<string> => {
      calls += 1;
      return "v";
    };

    const result = await withCache("k", true, load, config);
    expect(result.status).toBe("bypass");
    expect(calls).toBe(1);
    await expect(l1.get("k")).resolves.toBeUndefined();
    await expect(l2.get("k")).resolves.toBeUndefined();
  });

  test("keeps X-Cache semantics stable across store orders", async () => {
    const store: CacheStore = new MemoryStore(new Map());
    const config: RuntimeConfig = { stores: [store], ttlSeconds: 30 };
    const miss = await withCache("x", false, async () => 1, config);
    const hit = await withCache("x", false, async () => 2, config);
    expect(miss.status).toBe("miss");
    expect(hit).toStrictEqual({ status: "hit", value: 1 });
  });
});

describe("cache configuration helpers", () => {
  test("buildCacheKey sorts entries deterministically", () => {
    expect(buildCacheKey({ a: 1, b: 2 })).toBe("a=1&b=2");
  });

  test("parseTtlSeconds falls back to 3600 for junk", () => {
    expect(parseTtlSeconds("7200")).toBe(7200);
    expect(parseTtlSeconds()).toBe(3600);
    expect(parseTtlSeconds("-5")).toBe(3600);
    expect(parseTtlSeconds("abc")).toBe(3600);
  });

  test("memoryConfig exposes a single memory layer", () => {
    const config = memoryConfig(120);
    expect(config.ttlSeconds).toBe(120);
    expect(config.stores).toHaveLength(1);
  });
});
