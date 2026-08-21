import type { CacheEntry, CacheStore } from "./cache.js";

const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export interface MinimalCache {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
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
      if (!response) {
        return undefined;
      }
      // SAFETY: the edge only holds JSON envelopes written by set() below.
      const envelope = (await response.json()) as CacheEntry<T>;
      if (!envelope || !Number.isFinite(envelope.expiresAt)) {
        return undefined;
      }
      if (Date.now() > envelope.expiresAt) {
        return undefined;
      }
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
