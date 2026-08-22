import { Data } from "effect";
import type { Effect } from "effect";

export interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

export type CacheStoreOperation = "get" | "set";

export class CacheStoreError extends Data.TaggedError("CacheStoreError")<{
  readonly cause: unknown;
  readonly operation: CacheStoreOperation;
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
