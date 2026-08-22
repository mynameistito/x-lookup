import { Clock, Context, Effect, Layer, Option, Result, Schema } from "effect";

import {
  defaultCacheApi,
  layerWebCrypto,
  makeCacheApiStore,
} from "@/infrastructure/cache/cloudflare-store.ts";
import type { MinimalCache } from "@/infrastructure/cache/cloudflare-store.ts";
import type { CacheEntry, CacheStore } from "@/infrastructure/cache/store.ts";
import type { Env } from "@/runtime/env.ts";

export type CacheStatus = "hit" | "miss" | "bypass";

/**
 * A cache time-to-live in whole seconds. Branded so a raw environment string
 * or a millisecond value cannot be passed where parsed seconds are required.
 */
export type CacheTtlSeconds = typeof ttlSchema.Type;

const ttlSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand("CacheTtlSeconds")
);

const decodeTtl = Schema.decodeUnknownOption(ttlSchema);

export const DEFAULT_TTL_SECONDS: CacheTtlSeconds = Option.getOrThrow(
  decodeTtl(3600)
);

const MAX_MEMORY_ENTRIES = 500;

const sharedMemoryMap = new Map<string, CacheEntry<unknown>>();

/** L1 store shared per isolate unless an explicit map is supplied. */
export class MemoryStore implements CacheStore {
  private readonly map: Map<string, CacheEntry<unknown>>;

  constructor(map?: Map<string, CacheEntry<unknown>>) {
    this.map = map ?? sharedMemoryMap;
  }

  get<T>(key: string): Effect.Effect<CacheEntry<T> | undefined> {
    const { map } = this;
    return Effect.gen(function* memoryGet() {
      // SAFETY: values are only inserted by set() using the same cache key.
      const entry = map.get(key) as CacheEntry<T> | undefined;
      if (!entry) {
        return;
      }
      const now = yield* Clock.currentTimeMillis;
      if (now > entry.expiresAt) {
        map.delete(key);
        return;
      }
      // Refresh recency for the LRU cap.
      map.delete(key);
      map.set(key, entry);
      return entry;
    });
  }

  set<T>(key: string, value: T, ttlSeconds: number): Effect.Effect<void> {
    const { map } = this;
    return Effect.gen(function* memorySet() {
      const now = yield* Clock.currentTimeMillis;
      map.set(key, { expiresAt: now + ttlSeconds * 1000, value });
      if (map.size > MAX_MEMORY_ENTRIES) {
        const { value: oldest } = map.keys().next();
        if (oldest !== undefined) {
          map.delete(oldest);
        }
      }
    });
  }
}

const isolateMemoryStore = new MemoryStore();

/**
 * Parse the `CACHE_TTL_SECONDS` environment value into whole seconds.
 *
 * Junk, zero, and negative values fall back to {@link DEFAULT_TTL_SECONDS};
 * this configuration parse never fails, matching the historical behavior.
 */
export const parseTtlSeconds = (raw?: string): CacheTtlSeconds => {
  const parsed = Math.trunc(Number(raw ?? ""));
  return Option.getOrElse(decodeTtl(parsed), () => DEFAULT_TTL_SECONDS);
};

export interface CacheLookup<T> {
  readonly status: CacheStatus;
  readonly value: T;
}

export interface CacheService {
  readonly getOrLoad: <A, E, R>(
    key: string,
    bypass: boolean,
    load: Effect.Effect<A, E, R>
  ) => Effect.Effect<CacheLookup<A>, E, R>;
}

/** Owns cache lookup, backfill, expiry, write, and bypass policy. */
export class Cache extends Context.Service<Cache, CacheService>()(
  "x-lookup/lib/Cache"
) {}

const writeBestEffort = <T>(
  stores: readonly CacheStore[],
  key: string,
  value: T,
  ttlSeconds: number
): Effect.Effect<void> =>
  Effect.gen(function* writeConfiguredStores() {
    for (const store of stores) {
      yield* Effect.ignore(store.set(key, value, ttlSeconds));
    }
  });

const makeCache = (
  stores: readonly CacheStore[],
  ttlSeconds: CacheTtlSeconds
): Cache["Service"] => {
  const getOrLoad: CacheService["getOrLoad"] = <A, E, R>(
    key: string,
    bypass: boolean,
    load: Effect.Effect<A, E, R>
  ): Effect.Effect<CacheLookup<A>, E, R> =>
    Effect.gen(function* cacheGetOrLoad() {
      if (bypass) {
        return { status: "bypass" as const, value: yield* load };
      }

      let found:
        | { readonly entry: CacheEntry<A>; readonly index: number }
        | undefined;

      for (const [index, store] of stores.entries()) {
        const attempt = yield* Effect.result(store.get<A>(key));
        if (Result.isSuccess(attempt) && attempt.success !== undefined) {
          found = { entry: attempt.success, index };
          break;
        }
      }

      if (found) {
        const now = yield* Clock.currentTimeMillis;
        const remaining = Math.max(
          1,
          Math.ceil((found.entry.expiresAt - now) / 1000)
        );
        yield* writeBestEffort(
          stores.slice(0, found.index),
          key,
          found.entry.value,
          remaining
        );
        return { status: "hit" as const, value: found.entry.value };
      }

      const value = yield* load;
      yield* writeBestEffort(stores, key, value, ttlSeconds);
      return { status: "miss" as const, value };
    });

  return Cache.of({ getOrLoad });
};

const layerForStores = (
  stores: readonly CacheStore[],
  ttlSeconds: CacheTtlSeconds
): Layer.Layer<Cache> => Layer.succeed(Cache, makeCache(stores, ttlSeconds));

/** Complete isolated in-memory implementation suitable for deterministic tests. */
export const layerMemory = (
  ttlSeconds: CacheTtlSeconds = DEFAULT_TTL_SECONDS
): Layer.Layer<Cache> =>
  layerForStores([new MemoryStore(new Map())], ttlSeconds);

const layerCacheApiWithMemory = (
  cache: MinimalCache,
  memory: MemoryStore,
  ttlSeconds: CacheTtlSeconds
) =>
  Layer.effect(
    Cache,
    Effect.map(makeCacheApiStore(cache), (l2) =>
      makeCache([memory, l2], ttlSeconds)
    )
  );

/**
 * L1 + Cache API L2 layer that deliberately preserves its Effect Crypto
 * requirement so composition roots can choose the platform implementation.
 */
export const layerCacheApiWithoutDependencies = (
  cache: MinimalCache,
  ttlSeconds: CacheTtlSeconds = DEFAULT_TTL_SECONDS
) => layerCacheApiWithMemory(cache, new MemoryStore(new Map()), ttlSeconds);

/** Ready L1 + Cache API L2 layer backed by the runtime Web Crypto API. */
export const layerCacheApi = (
  cache: MinimalCache,
  ttlSeconds: CacheTtlSeconds = DEFAULT_TTL_SECONDS
): Layer.Layer<Cache> =>
  layerCacheApiWithoutDependencies(cache, ttlSeconds).pipe(
    Layer.provide(layerWebCrypto)
  );

/**
 * Worker composition: parse config once, keep isolate L1 state shared, and use
 * `caches.default` as L2 when workerd exposes it.
 */
export const layerWorker = (env: Env): Layer.Layer<Cache> => {
  const ttlSeconds = parseTtlSeconds(env.CACHE_TTL_SECONDS);
  const l2 = defaultCacheApi();
  if (!l2) {
    return layerForStores([isolateMemoryStore], ttlSeconds);
  }
  return layerCacheApiWithMemory(l2, isolateMemoryStore, ttlSeconds).pipe(
    Layer.provide(layerWebCrypto)
  );
};

export const buildCacheKey = (parts: Record<string, string | number>): string =>
  Object.entries(parts)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

export const cacheControlHeader = (): string =>
  "public, max-age=0, must-revalidate";
