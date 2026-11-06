/**
 * Cloudflare KVNamespace-compatible store for OAuth tokens/sessions.
 *
 * Uses Redis when REDIS_URL is set (Azure Cache for Redis); otherwise an
 * in-memory Map suitable for local single-process development.
 */

type RedisClient = {
  status: string;
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<number>;
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
  quit(): Promise<string>;
};

type KvGetOptions =
  | "text"
  | "json"
  | "arrayBuffer"
  | "stream"
  | Partial<{ type: "text" | "json" | "arrayBuffer" | "stream"; cacheTtl: number }>;

type KvPutOptions = {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
};

type KvListOptions = {
  prefix?: string;
  limit?: number;
  cursor?: string;
};

type KvListResult = {
  keys: { name: string; expiration?: number; metadata?: unknown }[];
  list_complete: boolean;
  cursor?: string;
};

interface KvBackend {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, expirationTtl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string, limit: number, cursor?: string): Promise<KvListResult>;
  close?(): Promise<void>;
}

class MemoryKvBackend implements KvBackend {
  private readonly store = new Map<string, { value: string; expiresAt?: number }>();

  private purgeIfExpired(key: string, entry: { value: string; expiresAt?: number }): string | null {
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return this.purgeIfExpired(key, entry);
  }

  async put(key: string, value: string, expirationTtl?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: expirationTtl !== undefined ? Date.now() + expirationTtl * 1000 : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix: string, limit: number, cursor?: string): Promise<KvListResult> {
    const keys = [...this.store.keys()]
      .filter((name) => name.startsWith(prefix))
      .sort();
    const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const slice = keys.slice(start, start + limit);
    const next = start + slice.length;
    const list_complete = next >= keys.length;
    return {
      keys: slice.map((name) => ({ name })),
      list_complete,
      ...(list_complete ? {} : { cursor: String(next) }),
    };
  }
}

class RedisKvBackend implements KvBackend {
  private readonly redis: RedisClient;
  private readonly keyPrefix: string;

  private constructor(redis: RedisClient, keyPrefix: string) {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  static async create(url: string, keyPrefix = "mcp-oauth:"): Promise<RedisKvBackend> {
    const mod = (await import("ioredis")) as unknown as {
      default?: new (url: string, opts?: object) => RedisClient;
      Redis?: new (url: string, opts?: object) => RedisClient;
    };
    const RedisCtor = mod.Redis ?? mod.default;
    if (!RedisCtor) {
      throw new Error("ioredis export not found");
    }
    const redis = new RedisCtor(url, { maxRetriesPerRequest: 3, lazyConnect: true });
    const backend = new RedisKvBackend(redis, keyPrefix);
    await backend.connect();
    return backend;
  }

  private async connect(): Promise<void> {
    if (this.redis.status === "wait") {
      await this.redis.connect();
    }
  }

  private namespaced(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(this.namespaced(key));
  }

  async put(key: string, value: string, expirationTtl?: number): Promise<void> {
    const full = this.namespaced(key);
    if (expirationTtl !== undefined) {
      await this.redis.set(full, value, "EX", Math.max(1, Math.floor(expirationTtl)));
    } else {
      await this.redis.set(full, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.namespaced(key));
  }

  async list(prefix: string, limit: number, cursor?: string): Promise<KvListResult> {
    const match = `${this.keyPrefix}${prefix}*`;
    const scanCursor = cursor && cursor.length > 0 ? cursor : "0";
    const [nextCursor, rawKeys] = await this.redis.scan(scanCursor, "MATCH", match, "COUNT", limit);
    const keys = rawKeys.map((full: string) => ({
      name: full.startsWith(this.keyPrefix) ? full.slice(this.keyPrefix.length) : full,
    }));
    const list_complete = nextCursor === "0";
    return {
      keys: keys.slice(0, limit),
      list_complete,
      ...(list_complete ? {} : { cursor: nextCursor }),
    };
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Creates a KVNamespace-shaped object backed by Redis or memory.
 */
export async function createOAuthKv(redisUrl?: string): Promise<KVNamespace & { close?: () => Promise<void> }> {
  let backend: KvBackend;
  if (redisUrl && redisUrl.length > 0) {
    backend = await RedisKvBackend.create(redisUrl);
    console.log("[azure-mcp] OAuth KV using Redis");
  } else {
    backend = new MemoryKvBackend();
    console.log("[azure-mcp] OAuth KV using in-memory store (set REDIS_URL for Redis)");
  }

  const kv = {
    async get(key: string, options?: KvGetOptions): Promise<any> {
      const raw = await backend.get(key);
      if (raw === null) return null;
      const type =
        typeof options === "string"
          ? options
          : options && typeof options === "object"
            ? options.type
            : undefined;
      if (type === "json") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      if (type === "arrayBuffer") {
        return new TextEncoder().encode(raw).buffer;
      }
      return raw;
    },

    async put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: KvPutOptions): Promise<void> {
      let text: string;
      if (typeof value === "string") {
        text = value;
      } else if (value instanceof ArrayBuffer) {
        text = new TextDecoder().decode(value);
      } else {
        text = new TextDecoder().decode(value as ArrayBufferView);
      }
      let ttl = options?.expirationTtl;
      if (ttl === undefined && options?.expiration !== undefined) {
        ttl = Math.max(1, options.expiration - Math.floor(Date.now() / 1000));
      }
      await backend.put(key, text, ttl);
    },

    async delete(key: string): Promise<void> {
      await backend.delete(key);
    },

    async list(options?: KvListOptions): Promise<KvListResult> {
      return backend.list(options?.prefix ?? "", options?.limit ?? 1000, options?.cursor);
    },

    async getWithMetadata(key: string, options?: KvGetOptions): Promise<any> {
      const value = await kv.get(key, options);
      return { value, metadata: null, cacheStatus: null };
    },

    async close(): Promise<void> {
      await backend.close?.();
    },
  };

  return kv as unknown as KVNamespace & { close?: () => Promise<void> };
}
