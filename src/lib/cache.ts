import type { Env } from "../env.js";
import { CacheApiStore } from "./cache-api-store.js";
import type { MinimalCache } from "./cache-api-store.js";

export { CacheApiStore } from "./cache-api-store.js";

export type CacheStatus = "hit" | "miss" | "bypass";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStore {
  get: <T>(key: string) => Promise<CacheEntry<T> | undefined>;
  set: <T>(key: string, value: T, ttlSeconds: number) => Promise<void>;
}

export const DEFAULT_TTL_SECONDS = 3600;
const MAX_MEMORY_ENTRIES = 500;

interface MemoryEnvelope<T> {
  entry: CacheEntry<T>;
}

const sharedMemoryMap = new Map<string, MemoryEnvelope<unknown>>();

/** L1 store shared per isolate. Instances without an explicit map share one. */
export class MemoryStore implements CacheStore {
  private readonly map: Map<string, MemoryEnvelope<unknown>>;

  constructor(map?: Map<string, MemoryEnvelope<unknown>>) {
    this.map = map ?? sharedMemoryMap;
  }

  get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    return Promise.resolve(this.lookup(key));
  }

  private lookup<T>(key: string): CacheEntry<T> | undefined {
    // SAFETY: the shared map stores MemoryEnvelope values under cache keys.
    const envelope = this.map.get(key) as MemoryEnvelope<T> | undefined;
    if (!envelope) {
      return undefined;
    }
    if (Date.now() > envelope.entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency for the LRU cap.
    this.map.delete(key);
    this.map.set(key, envelope);
    return envelope.entry;
  }

  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.map.set(key, {
      entry: { expiresAt: Date.now() + ttlSeconds * 1000, value },
    });
    while (this.map.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
    return Promise.resolve();
  }
}

export const memoryStore = new MemoryStore();

// SAFETY: workerd exposes caches.default; the guard covers runtimes without it.
const defaultCacheApi = (): MinimalCache | undefined =>
  (globalThis as { caches?: { default?: MinimalCache } }).caches?.default;

export const parseTtlSeconds = (raw?: string): number => {
  const parsed = Math.trunc(Number(raw ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
};

export interface RuntimeConfig {
  ttlSeconds: number;
  stores: CacheStore[];
}

export interface CacheLookup<T> {
  status: CacheStatus;
  value: T;
}

/** Memory-only config used by tests and as a safe default. */
export const memoryConfig = (
  ttlSeconds = DEFAULT_TTL_SECONDS
): RuntimeConfig => ({ stores: [memoryStore], ttlSeconds });

/** Worker config: memory L1 plus Cache API L2 when the runtime provides it. */
export const workerConfig = (env: Env): RuntimeConfig => {
  const stores: CacheStore[] = [memoryStore];
  const l2 = defaultCacheApi();
  if (l2) {
    stores.push(new CacheApiStore(l2));
  }
  return { stores, ttlSeconds: parseTtlSeconds(env.CACHE_TTL_SECONDS) };
};

export const buildCacheKey = (parts: Record<string, string | number>): string =>
  Object.entries(parts)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

export const withCache = async <T>(
  key: string,
  nocache: boolean,
  fn: () => Promise<T>,
  config: RuntimeConfig = memoryConfig()
): Promise<CacheLookup<T>> => {
  if (nocache) {
    return { status: "bypass", value: await fn() };
  }

  const findHit = async (
    index: number
  ): Promise<{ entry: CacheEntry<T>; index: number } | undefined> => {
    const store = config.stores[index];
    if (!store) {
      return undefined;
    }
    const hit = await store.get<T>(key);
    return hit === undefined ? findHit(index + 1) : { entry: hit, index };
  };

  const found = await findHit(0);
  if (found) {
    const remaining = Math.max(
      1,
      Math.ceil((found.entry.expiresAt - Date.now()) / 1000)
    );
    await Promise.all(
      config.stores
        .slice(0, found.index)
        .map((store) => store.set(key, found.entry.value, remaining))
    );
    return { status: "hit", value: found.entry.value };
  }

  const value = await fn();
  await Promise.all(
    config.stores.map((store) => store.set(key, value, config.ttlSeconds))
  );
  return { status: "miss", value };
};

export const cacheControlHeader = (): string =>
  "public, max-age=0, must-revalidate";
