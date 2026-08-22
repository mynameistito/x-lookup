import { Clock, Effect } from "effect";

import type { CacheEntry, CacheStore } from "@/infrastructure/cache/store.ts";

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
