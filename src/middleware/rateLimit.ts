import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ServerConfig, User } from "../types/index.js";

// Rate limit store interface
interface RateLimitEntry {
  count: number;
  resetTime: number;
  firstRequest: number;
}

// Rate limit configuration
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests: boolean;
  skipFailedRequests: boolean;
  keyGenerator: (c: Context) => string;
  skip: (c: Context) => boolean;
  onLimitReached?: (c: Context, key: string) => void;
}

// In-memory rate limit store
class MemoryStore {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(windowMs: number) {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
      }
    }
  }

  get(key: string): RateLimitEntry | undefined {
    const entry = this.store.get(key);
    if (entry && entry.resetTime < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  increment(key: string, windowMs: number): RateLimitEntry {
    const now = Date.now();
    const existing = this.get(key);

    if (existing) {
      existing.count++;
      return existing;
    }

    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
      firstRequest: now,
    };

    this.store.set(key, newEntry);
    return newEntry;
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  resetAll(): void {
    this.store.clear();
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  getStats(): { totalKeys: number; activeKeys: number } {
    const now = Date.now();
    let activeKeys = 0;

    for (const entry of this.store.values()) {
      if (entry.resetTime >= now) {
        activeKeys++;
      }
    }

    return {
      totalKeys: this.store.size,
      activeKeys,
    };
  }
}

// Global store instance
let globalStore: MemoryStore | null = null;

// Get or create store
function getStore(windowMs: number): MemoryStore {
  if (!globalStore) {
    globalStore = new MemoryStore(windowMs);
  }
  return globalStore;
}

// Default key generator (IP address)
const defaultKeyGenerator = (c: Context): string => {
  const forwarded = c.req.header("x-forwarded-for");
  const realIp = c.req.header("x-real-ip");
  const remoteAddr = c.req.header("remote-addr");

  // Extract first IP from forwarded header
  const ip = forwarded
    ? forwarded.split(",")[0]?.trim()
    : realIp || remoteAddr || "unknown";

  return `ip:${ip}`;
};

// Default skip function (never skip)
const defaultSkip = (): boolean => false;

// Create rate limit middleware
function createRateLimitMiddleware(config: Partial<RateLimitConfig> = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = 100,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = defaultKeyGenerator,
    skip = defaultSkip,
    onLimitReached,
  } = config;

  const store = getStore(windowMs);

  return async (c: Context, next: Next) => {
    // Skip if skip function returns true
    if (skip(c)) {
      await next();
      return;
    }

    const key = keyGenerator(c);
    const now = Date.now();

    // Get current limit info
    const entry = store.increment(key, windowMs);

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetTime = Math.ceil(entry.resetTime / 1000);

    c.header("X-RateLimit-Limit", maxRequests.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", resetTime.toString());
    c.header("X-RateLimit-Used", entry.count.toString());

    // Check if limit exceeded
    if (entry.count > maxRequests) {
      // Call onLimitReached callback if provided
      if (onLimitReached) {
        onLimitReached(c, key);
      }

      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      c.header("Retry-After", retryAfter.toString());

      throw new HTTPException(429, {
        message: `Too many requests. Limit: ${maxRequests} requests per ${Math.ceil(windowMs / 60000)} minutes. Try again in ${retryAfter} seconds.`,
      });
    }

    let statusCode: number | undefined;
    let error: any = null;

    try {
      await next();
      statusCode = c.res.status;
    } catch (err) {
      error = err;
      statusCode = err instanceof HTTPException ? err.status : 500;

      // Re-throw the error after handling
      throw err;
    } finally {
      // Decrement count for successful requests if configured
      if (skipSuccessfulRequests && statusCode && statusCode < 400) {
        const currentEntry = store.get(key);
        if (currentEntry && currentEntry.count > 0) {
          currentEntry.count--;
        }
      }

      // Decrement count for failed requests if configured
      if (skipFailedRequests && statusCode && statusCode >= 400) {
        const currentEntry = store.get(key);
        if (currentEntry && currentEntry.count > 0) {
          currentEntry.count--;
        }
      }
    }
  };
}

// Main rate limit middleware factory
export const rateLimitMiddleware = (serverConfig: ServerConfig) => {
  return createRateLimitMiddleware({
    windowMs: serverConfig.rateLimitWindowMs,
    maxRequests: serverConfig.rateLimitMaxRequests,
    keyGenerator: (c: Context) => {
      // Check for authenticated user
      const user = c.get("user") as User | undefined;

      if (user) {
        // Higher limits for authenticated users
        return `user:${user.id}`;
      }

      return defaultKeyGenerator(c);
    },
    skip: (c: Context) => {
      const user = c.get("user") as User | undefined;

      // Skip rate limiting for admin users
      if (user?.role === "admin") {
        return true;
      }

      // Skip for health checks
      if (c.req.path === "/health") {
        return true;
      }

      return false;
    },
    onLimitReached: (c: Context, key: string) => {
      const user = c.get("user") as User | undefined;
      const userInfo = user
        ? `user:${user.id} (${user.username})`
        : "anonymous";

      console.warn(`⚠️ Rate limit exceeded for ${userInfo} (${key})`);
    },
  });
};

// Strict rate limit for sensitive endpoints
export const strictRateLimit = createRateLimitMiddleware({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 10,
  keyGenerator: (c: Context) => {
    const user = c.get("user") as User | undefined;
    const ip = defaultKeyGenerator(c);

    // Combine user and IP for strict endpoints
    return user ? `strict:${user.id}:${ip}` : `strict:${ip}`;
  },
  skip: (c: Context) => {
    const user = c.get("user") as User | undefined;
    return user?.role === "admin";
  },
});

// Auth rate limit (for login/register endpoints)
export const authRateLimit = createRateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // Only 5 attempts per 15 minutes
  keyGenerator: (c: Context) => {
    // For auth endpoints, use IP + email if available
    // const email = c.req.json?.then?.((body) => body?.email);
    const ip = defaultKeyGenerator(c);

    return `auth:${ip}`;
  },
  onLimitReached: (c: Context, key: string) => {
    console.warn(`🚨 Authentication rate limit exceeded for ${key}`);
  },
});

// Upload rate limit
export const uploadRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 50, // 50 uploads per hour
  keyGenerator: (c: Context) => {
    const user = c.get("user") as User | undefined;
    return user ? `upload:${user.id}` : `upload:${defaultKeyGenerator(c)}`;
  },
  skip: (c: Context) => {
    const user = c.get("user") as User | undefined;
    return user?.role === "admin" || user?.role === "developer";
  },
});

// API key rate limit (higher limits for API usage)
export const apiKeyRateLimit = createRateLimitMiddleware({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 1000, // 1000 requests per hour for API keys
  keyGenerator: (c: Context) => {
    const apiKey = c.get("apiKey") as { id: string } | undefined;
    const user = c.get("user") as User | undefined;

    if (apiKey) {
      return `apikey:${apiKey.id}`;
    }

    return user ? `user:${user.id}` : defaultKeyGenerator(c);
  },
});

// Get rate limit status for a key
export const getRateLimitStatus = (
  key: string,
  windowMs: number = 15 * 60 * 1000,
) => {
  const store = getStore(windowMs);
  const entry = store.get(key);

  if (!entry) {
    return {
      count: 0,
      remaining: 100, // Default max
      resetTime: Date.now() + windowMs,
      isLimited: false,
    };
  }

  const maxRequests = 100; // Default max

  return {
    count: entry.count,
    remaining: Math.max(0, maxRequests - entry.count),
    resetTime: entry.resetTime,
    isLimited: entry.count >= maxRequests,
  };
};

// Reset rate limit for a specific key
export const resetRateLimit = (
  key: string,
  windowMs: number = 15 * 60 * 1000,
) => {
  const store = getStore(windowMs);
  store.reset(key);
};

// Get rate limit statistics
export const getRateLimitStats = (windowMs: number = 15 * 60 * 1000) => {
  const store = getStore(windowMs);
  return store.getStats();
};

// Cleanup function for graceful shutdown
export const cleanupRateLimit = () => {
  if (globalStore) {
    globalStore.destroy();
    globalStore = null;
  }
};

// Export store for testing
export const __testing__ = {
  getStore,
  MemoryStore,
};
