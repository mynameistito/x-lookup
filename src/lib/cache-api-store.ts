import {
  Clock,
  Crypto as EffectCrypto,
  Effect,
  Layer,
  PlatformError,
  Schema,
} from "effect";

import type {
  CacheEntry,
  CacheStore,
  CacheStoreOperation,
} from "./cache-store.js";
import { CacheStoreError } from "./cache-store.js";

const CACHE_PREFIX = "https://x-lookup.cache/__cache";

export interface MinimalCache {
  readonly match: (key: string) => Promise<Response | undefined>;
  readonly put: (key: string, response: Response) => Promise<void>;
}

interface WorkerdCrypto {
  readonly getRandomValues: (array: Uint8Array) => Uint8Array;
  readonly subtle: {
    readonly digest: (
      algorithm: EffectCrypto.DigestAlgorithm,
      data: Uint8Array
    ) => Promise<ArrayBuffer>;
  };
}

const CacheEnvelopeSchema = Schema.Struct({
  expiresAt: Schema.Number,
  value: Schema.Unknown,
});

const decodeCacheEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CacheEnvelopeSchema)
);

const storeError = (
  operation: CacheStoreOperation,
  cause: unknown
): CacheStoreError => new CacheStoreError({ cause, operation });

const digestHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const cacheUrl = (
  crypto: EffectCrypto.Crypto,
  prefix: string,
  key: string,
  operation: CacheStoreOperation
): Effect.Effect<string, CacheStoreError> =>
  crypto.digest("SHA-256", new TextEncoder().encode(key)).pipe(
    Effect.mapError((cause) => storeError(operation, cause)),
    Effect.map((digest) => `${prefix}/${digestHex(digest)}`)
  );

const readCacheEntry = <T>(
  cache: MinimalCache,
  crypto: EffectCrypto.Crypto,
  prefix: string,
  key: string
): Effect.Effect<CacheEntry<T> | undefined, CacheStoreError> =>
  Effect.gen(function* cacheApiGet() {
    const url = yield* cacheUrl(crypto, prefix, key, "get");
    const response = yield* Effect.tryPromise({
      catch: (cause) => storeError("get", cause),
      try: () => cache.match(url),
    });
    if (!response) {
      return;
    }

    const serialized = yield* Effect.tryPromise({
      catch: (cause) => storeError("get", cause),
      try: () => response.text(),
    });
    const payload = yield* decodeCacheEnvelope(serialized).pipe(
      Effect.mapError((cause) => storeError("get", cause))
    );
    const now = yield* Clock.currentTimeMillis;
    if (now > payload.expiresAt) {
      return;
    }

    return {
      expiresAt: payload.expiresAt,
      // SAFETY: the cache authority writes and reads values under the same
      // typed cache key; the envelope schema already validates its structure.
      value: payload.value as T,
    };
  });

const writeCacheEntry = <T>(
  cache: MinimalCache,
  crypto: EffectCrypto.Crypto,
  prefix: string,
  key: string,
  value: T,
  ttlSeconds: number
): Effect.Effect<void, CacheStoreError> =>
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
    const url = yield* cacheUrl(crypto, prefix, key, "set");
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

/**
 * Build the Cloudflare Cache API store while preserving the Effect Crypto
 * requirement for the composition root to satisfy.
 */
export const makeCacheApiStore = (
  cache: MinimalCache,
  prefix = CACHE_PREFIX
): Effect.Effect<CacheStore, never, EffectCrypto.Crypto> =>
  EffectCrypto.Crypto.pipe(
    Effect.map((crypto): CacheStore => ({
      get: <T>(key: string) => readCacheEntry<T>(cache, crypto, prefix, key),
      set: <T>(key: string, value: T, ttlSeconds: number) =>
        writeCacheEntry(cache, crypto, prefix, key, value, ttlSeconds),
    }))
  );

const makeWebCryptoService = (): EffectCrypto.Crypto => {
  // SAFETY: workerd provides the Web Crypto runtime even though the project
  // intentionally omits DOM globals from tsconfig and types it at this adapter.
  const { crypto: webCrypto } = globalThis as typeof globalThis & {
    readonly crypto: WorkerdCrypto;
  };

  const randomBytes = (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    for (let index = 0; index < bytes.length; index += 65_536) {
      webCrypto.getRandomValues(bytes.subarray(index, index + 65_536));
    }
    return bytes;
  };

  const digest: EffectCrypto.Crypto["digest"] = (algorithm, data) =>
    Effect.map(
      Effect.tryPromise({
        catch: (cause) =>
          PlatformError.systemError({
            _tag: "Unknown",
            cause,
            description: "Could not compute digest",
            method: "digest",
            module: "Crypto",
          }),
        try: () => webCrypto.subtle.digest(algorithm, new Uint8Array(data)),
      }),
      (buffer) => new Uint8Array(buffer)
    );

  return EffectCrypto.make({ digest, randomBytes });
};

/** Effect Crypto backed by the Web Crypto API available in workerd. */
export const layerWebCrypto: Layer.Layer<EffectCrypto.Crypto> = Layer.effect(
  EffectCrypto.Crypto,
  Effect.sync(makeWebCryptoService)
);

/** Return workerd's default Cache API binding when the runtime provides it. */
export const defaultCacheApi = (): MinimalCache | undefined => {
  // SAFETY: Cloudflare exposes `caches.default` at runtime; tests may omit the
  // binding entirely, so the adapter models that runtime property as optional.
  const runtime = globalThis as typeof globalThis & {
    readonly caches?: { readonly default?: MinimalCache };
  };
  return runtime.caches?.default;
};
