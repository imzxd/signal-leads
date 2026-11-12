/**
 * Fixed-window rate limiter. In-memory implementation suits a single instance and local dev;
 * swap `store` for Redis/Upstash in multi-instance deployments — call sites stay the same.
 */
interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Window;
}

class MemoryStore implements RateLimitStore {
  private windows = new Map<string, Window>();
  hit(key: string, windowMs: number): Window {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) {
        for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
      }
    }
    w.count++;
    return w;
  }
}

const g = globalThis as typeof globalThis & { __signalRateLimit?: RateLimitStore };
const store: RateLimitStore = (g.__signalRateLimit ??= new MemoryStore());

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const w = store.hit(key, windowMs);
  return { allowed: w.count <= limit, remaining: Math.max(0, limit - w.count), resetAt: w.resetAt };
}
