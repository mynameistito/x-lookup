import { Clock, Crypto, Effect, Layer, PlatformError } from "effect";

import type { CacheEntry, CacheStore } from "./cache.js";
import { CacheStoreError } from "./cache.js";

const CACHE_PREFIX = "https://x-lookup.cache/__cache";

export interface MinimalCache {
  readonly match: (key: string) => Promise<Response | undefined>;
  readonly put: (key: string, response: Response) => Promise<void>;
}

interface CacheEnvelope {
  readonly expiresAt: number;
  readonly value: unknown;
}

const isCacheEnvelope = (value: unknown): value is CacheEnvelope =>
  typeof value === "object" &&
  value !== null &&
  "expiresAt" in value &&
  typeof value.expiresAt === "number" &&
  Number.isFinite(value.expiresAt) &&
  "value" in value;

const storeError = (
  operation: CacheStoreError["operation"],
  cause: unknown
): CacheStoreError => new CacheStoreError({ cause, operation });

/**
 * Build the Cloudflare Cache API store while preserving the Effect Crypto
 * requirement for the composition root to satisfy.
 */
export const makeCacheApiStore = (
  cache: MinimalCache,
  prefix = CACHE_PREFIX
): Effect.Effect<CacheStore, never, Crypto.Crypto> =>
  Effect.gen(function* makeCacheApiStoreEffect() {
    const crypto = yield* Crypto.Crypto;

    const urlFor = (
      key: string,
      operation: CacheStoreError["operation"]
    ): Effect.Effect<string, CacheStoreError> =>
      crypto
        .digest("SHA-256", new TextEncoder().encode(key))
        .pipe(
          Effect.mapError((cause) => storeError(operation, cause)),
          Effect.map(
            (digest) =>
              `${prefix}/${[...digest]
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join("")}`
          )
        );

    const get: CacheStore["get"] = <T>(key: string) =>
      Effect.gen(function* cacheApiGet() {
        const url = yield* urlFor(key, "get");
        const response = yield* Effect.tryPromise({
          catch: (cause) => storeError("get", cause),
          try: () => cache.match(url),
        });
        if (!response) {
          return undefined;
        }
        const payload: unknown = yield* Effect.tryPromise({
          catch: (cause) => storeError("get", cause),
          try: () => response.json(),
        });
        if (!isCacheEnvelope(payload)) {
          return undefined;
        }
        const now = yield* Clock.currentTimeMillis;
        if (now > payload.expiresAt) {
          return undefined;
        }
        // SAFETY: the cache service reads values back under the same typed key
        // used when this adapter serialized them.
        return payload as CacheEntry<T>;
      });

    const set: CacheStore["set"] = <T>(
      key: string,
      value: T,
      ttlSeconds: number
    ) =>
      Effect.gen(function* cacheApiSet() {
        const now = yield* Clock.currentTimeMillis;
        const envelope: CacheEntry<T> = {
          expiresAt: now + ttlSeconds * 1000,
          value,
        };
        const body = yield* Effect.try({
          catch: (cause) => storeError("set", cause),
          try: () => JSON.stringify(envelope),
        });
        const url = yield* urlFor(key, "set");
        yield* Effect.tryPromise({
          catch: (cause) => storeError("set", cause),
          try: () =>
            cache.put(
              url,
              new Response(body, {
                headers: {
                  "Cache-Control": `public, max-age=${ttlSeconds}`,
                  "Content-Type": "application/json",
                },
              })
            ),
        });
      });

    return { get, set };
  });

/** Effect Crypto backed by the Web Crypto API available in workerd. */
export const layerWebCrypto: Layer.Layer<Crypto.Crypto> = Layer.effect(
  Crypto.Crypto,
  Effect.gen(function* makeWebCrypto() {
    const crypto = globalThis.crypto;
    if (!crypto) {
      return yield* Effect.die(new Error("Web Crypto API is not available"));
    }

    const randomBytes = (size: number): Uint8Array => {
      const bytes = new Uint8Array(size);
      for (let index = 0; index < bytes.length; index += 65_536) {
        crypto.getRandomValues(bytes.subarray(index, index + 65_536));
      }
      return bytes;
    };

    const digest: Crypto.Crypto["digest"] = (algorithm, data) => {
      if (typeof crypto.subtle.digest !== "function") {
        return Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            description: "crypto.subtle.digest is not available",
            method: "digest",
            module: "Crypto",
          })
        );
      }
      return Effect.map(
        Effect.tryPromise({
          catch: (cause) =>
            PlatformError.systemError({
              _tag: "Unknown",
              cause,
              description: "Could not compute digest",
              method: "digest",
              module: "Crypto",
            }),
          try: () => crypto.subtle.digest(algorithm, new Uint8Array(data)),
        }),
        (buffer) => new Uint8Array(buffer)
      );
    };

    return Crypto.make({ digest, randomBytes });
  })
);

/** Return workerd's default Cache API binding when the runtime provides it. */
export const defaultCacheApi = (): MinimalCache | undefined =>
  (globalThis as { caches?: { default?: MinimalCache } }).caches?.default;
