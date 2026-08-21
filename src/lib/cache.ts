import { Clock, Context, Data, Effect, Layer, Option, Schema } from "effect";

import type { Env } from "../env.js";
import {
  defaultCacheApi,
  layerWebCrypto,
  makeCacheApiStore,
} from "./cache-api-store.js";
import type { MinimalCache } from "./cache-api-store.js";

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

export interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

export class CacheStoreError extends Data.TaggedError("CacheStoreError")<{
  readonly cause: unknown;
  readonly operation: "get" | "set";
}> {}

/** Technology-independent store contract owned by the cache authority seam. */
export interface CacheStore {
  readonly get: <T>(
    key: string
  ) => Effect.Effect<CacheEntry<T> | undefined, CacheStoreError>;
  readonly set: <T>(
    key: string,
    value: T,
    ttlSeconds: number
  ) => Effect.Effect<void, CacheStoreError>;
}

const MAX_MEMORY_ENTRIES = 500;

interface MemoryEnvelope<T> {
  readonly entry: CacheEntry<T>;
}

const sharedMemoryMap = new Map<string, MemoryEnvelope<unknown>>();

/** L1 store shared per isolate unless an explicit map is supplied. */
export class MemoryStore implements CacheStore {
  private readonly map: Map<string, MemoryEnvelope<unknown>>;

  constructor(map?: Map<string, MemoryEnvelope<unknown>>) {
    this.map = map ?? sharedMemoryMap;
  }

  get<T>(key: string): Effect.Effect<CacheEntry<T> | undefined> {
    const map = this.map;
    return Effect.gen(function* memoryGet() {
      // SAFETY: values are only inserted by set() using the same cache key.
      const envelope = map.get(key) as MemoryEnvelope<T> | undefined;
      if (!envelope) {
        return undefined;
      }
      const now = yield* Clock.currentTimeMillis;
      if (now > envelope.entry.expiresAt) {
        map.delete(key);
        return undefined;
      }
      // Refresh recency for the LRU cap.
      map.delete(key);
      map.set(key, envelope);
      return envelope.entry;
    });
  }

  set<T>(
    key: string,
    value: T,
    ttlSeconds: number
  ): Effect.Effect<void> {
    const map = this.map;
    return Effect.gen(function* memorySet() {
      const now = yield* Clock.currentTimeMillis;
      map.set(key, {
        entry: { expiresAt: now + ttlSeconds * 1000, value },
      });
      while (map.size > MAX_MEMORY_ENTRIES) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        map.delete(oldest);
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

const makeCache = (
  stores: readonly CacheStore[],
  ttlSeconds: CacheTtlSeconds
): Cache["Service"] => {
  const writeBestEffort = <T>(
    targets: readonly CacheStore[],
    key: string,
    value: T,
    ttl: number
  ): Effect.Effect<void> =>
    Effect.gen(function* writeConfiguredStores() {
      for (const store of targets) {
        yield* store.set(key, value, ttl).pipe(
          Effect.catch(() => Effect.void)
        );
      }
    });

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

      for (let index = 0; index < stores.length; index += 1) {
        const store = stores[index];
        if (!store) {
          continue;
        }
        const hit = yield* store.get<A>(key).pipe(
          Effect.catch(() => Effect.succeed(undefined))
        );
        if (hit !== undefined) {
          found = { entry: hit, index };
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

/** Isolate-shared memory implementation used by the temporary Promise bridges. */
export const layerIsolateMemory = (
  ttlSeconds: CacheTtlSeconds = DEFAULT_TTL_SECONDS
): Layer.Layer<Cache> => layerForStores([isolateMemoryStore], ttlSeconds);

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
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

export const cacheControlHeader = (): string =>
  "public, max-age=0, must-revalidate";
