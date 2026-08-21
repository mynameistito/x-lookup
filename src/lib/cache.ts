import type { Env } from "../env.js";

export type CacheStatus = "hit" | "miss" | "bypass";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export const DEFAULT_TTL_SECONDS = 3600;
const MAX_MEMORY_ENTRIES = 500;

interface MemoryEnvelope<T> {
  entry: CacheEntry<T>;
}

/** L1 store shared per isolate. Instances without an explicit map share one. */
export class MemoryStore implements CacheStore {
  private readonly map: Map<string, MemoryEnvelope<unknown>>;

  constructor(map?: Map<string, MemoryEnvelope<unknown>>) {
    this.map = map ?? sharedMemoryMap;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    const envelope = this.map.get(key) as MemoryEnvelope<T> | undefined;
    if (!envelope) {return undefined;}
    if (Date.now() > envelope.entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency for the LRU cap.
    this.map.delete(key);
    this.map.set(key, envelope);
    return envelope.entry;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.map.set(key, {
      entry: { expiresAt: Date.now() + ttlSeconds * 1000, value },
    });
    while (this.map.size > MAX_MEMORY_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {break;}
      this.map.delete(oldest);
    }
  }
}

const sharedMemoryMap = new Map<string, MemoryEnvelope<unknown>>();
export const memoryStore = new MemoryStore();

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface MinimalCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/**
 * L2 store backed by the Cloudflare Cache API (`caches.default`).
 * Keys are hashed into synthetic URLs under `prefix`.
 */
export class CacheApiStore implements CacheStore {
  private readonly cache: MinimalCache;
  private readonly prefix: string;

  constructor(cache: MinimalCache, prefix = "https://x-lookup.cache/__cache") {
    this.cache = cache;
    this.prefix = prefix;
  }

  private async urlFor(key: string): Promise<string> {
    return `${this.prefix}/${await sha256Hex(key)}`;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      const response = await this.cache.match(await this.urlFor(key));
      if (!response) {return undefined;}
      const envelope = (await response.json()) as CacheEntry<T>;
      if (!envelope || typeof envelope.expiresAt !== "number") {return undefined;}
      if (Date.now() > envelope.expiresAt) {return undefined;}
      return envelope;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const envelope: CacheEntry<T> = {
        expiresAt: Date.now() + ttlSeconds * 1000,
        value,
      };
      const body = JSON.stringify(envelope);
      await this.cache.put(
        await this.urlFor(key),
        new Response(body, {
          headers: {
            "Cache-Control": `public, max-age=${ttlSeconds}`,
            "Content-Type": "application/json",
          },
        })
      );
    } catch {
      // Best-effort edge cache.
    }
  }
}

function defaultCacheApi(): MinimalCache | undefined {
  const storage = (globalThis as { caches?: { default?: MinimalCache } }).caches
    ?.default;
  return storage ?? undefined;
}

export function parseTtlSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
}

export interface RuntimeConfig {
  ttlSeconds: number;
  stores: CacheStore[];
}

/** Memory-only config used by tests and as a safe default. */
export function memoryConfig(ttlSeconds = DEFAULT_TTL_SECONDS): RuntimeConfig {
  return { stores: [memoryStore], ttlSeconds };
}

/** Worker config: memory L1 plus Cache API L2 when the runtime provides it. */
export function workerConfig(env: Env): RuntimeConfig {
  const stores: CacheStore[] = [memoryStore];
  const l2 = defaultCacheApi();
  if (l2) {stores.push(new CacheApiStore(l2));}
  return { stores, ttlSeconds: parseTtlSeconds(env.CACHE_TTL_SECONDS) };
}

export function buildCacheKey(parts: Record<string, string | number>): string {
  return Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export async function withCache<T>(
  key: string,
  nocache: boolean,
  fn: () => Promise<T>,
  config: RuntimeConfig = memoryConfig()
): Promise<{ value: T; status: CacheStatus }> {
  if (nocache) {return { value: await fn(), status: "bypass" };}

  for (let index = 0; index < config.stores.length; index += 1) {
    const hit = await config.stores[index]?.get<T>(key);
    if (hit === undefined) {continue;}
    for (let backfill = 0; backfill < index; backfill += 1) {
      const remaining = Math.max(
        1,
        Math.ceil((hit.expiresAt - Date.now()) / 1000)
      );
      await config.stores[backfill]?.set(key, hit.value, remaining);
    }
    return { status: "hit", value: hit.value };
  }

  const value = await fn();
  await Promise.all(
    config.stores.map((store) => store.set(key, value, config.ttlSeconds))
  );
  return { status: "miss", value };
}

export function cacheControlHeader(): string {
  return "public, max-age=0, must-revalidate";
}
