/**
 * Thin Redis wrapper for persisting the QBO refresh token across pod restarts.
 *
 * The refresh token is rotated by Intuit on every use. Writing it to a flat
 * .env file is unsafe in Kubernetes because the file is ephemeral — it is lost
 * on every pod restart, causing a 400 "invalid_grant" error until the original
 * (stale) token from GCP Secret Manager is manually replaced.
 *
 * Instead, the latest rotated token is stored in Redis under the key
 * `qbo:refresh_token`. On startup the client reads from Redis first and falls
 * back to the env var (bootstrap / first deploy). When the token rotates it is
 * written back to Redis so the next pod start picks it up.
 *
 * If REDIS_URL is not set (local dev / CI) the module is a no-op and the
 * existing env-var / .env fallback continues to work unchanged.
 */

import IORedis from "ioredis";
const { default: Redis } = IORedis as any;
type RedisClient = InstanceType<typeof Redis>;

const REDIS_KEY = "qbo:refresh_token";
const CONNECT_TIMEOUT_MS = 3_000;

let client: RedisClient | null = null;
let clientInitialized = false;

function getClient(): RedisClient | null {
  if (clientInitialized) return client;
  clientInitialized = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.error("[redis-token-store] REDIS_URL not set — token persistence via Redis disabled");
    return null;
  }

  client = new Redis(url, {
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times: number) => (times <= 3 ? Math.min(times * 200, 1000) : null),
  });

  client.on("error", (err: Error) => {
    // Log but never throw — Redis being down must not break QBO calls.
    console.error("[redis-token-store] Redis error:", err.message);
  });

  return client;
}

/**
 * Returns the refresh token stored in Redis, or null if not found / unavailable.
 * Call this on startup before falling back to the QUICKBOOKS_REFRESH_TOKEN env var.
 */
export async function getRefreshToken(): Promise<string | null> {
  try {
    const redis = getClient();
    if (!redis) return null;
    const value = await redis.get(REDIS_KEY);
    if (value) {
      console.error("[redis-token-store] Loaded refresh token from Redis");
    }
    return value;
  } catch (err) {
    console.error("[redis-token-store] Failed to read refresh token:", err);
    return null;
  }
}

/**
 * Persists the rotated refresh token to Redis.
 * Errors are swallowed — the in-memory token remains valid even if Redis is down.
 */
export async function setRefreshToken(token: string): Promise<void> {
  try {
    const redis = getClient();
    if (!redis) return;
    await redis.set(REDIS_KEY, token);
    console.error("[redis-token-store] Refresh token persisted to Redis");
  } catch (err) {
    console.error("[redis-token-store] Failed to persist refresh token:", err);
  }
}
