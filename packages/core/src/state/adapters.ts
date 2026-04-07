// packages/core/src/state/adapters.ts
// Pluggable State Adapters for Saga & Audit Persistence
// Defaults to Memory, swappable for Redis/PostgreSQL in production

export interface IStateAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export class MemoryAdapter implements IStateAdapter {
  private store = new Map<string, { value: any; expiry?: number }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiry && Date.now() > item.expiry) { this.store.delete(key); return null; }
    return item.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value, expiry: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
  }

  async del(key: string): Promise<void> { this.store.delete(key); }
  async keys(prefix: string): Promise<string[]> { return Array.from(this.store.keys()).filter(k => k.startsWith(prefix)); }
}

// Production Redis Adapter (npm install redis required)
// export class RedisAdapter implements IStateAdapter { ... }
