import { Redis } from "@upstash/redis";

declare global {
  // eslint-disable-next-line no-var
  var _pluRedisClient: Redis | undefined;
}

function createRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn(
      "[redis] UPSTASH_REDIS_REST_URL ou UPSTASH_REDIS_REST_TOKEN manquant, cache désactivé.",
    );
    return null;
  }

  try {
    return new Redis({ url, token });
  } catch (error) {
    console.warn("[redis] Impossible d'initialiser le client Upstash Redis.", error);
    return null;
  }
}

const redisClient: Redis | null =
  typeof globalThis === "undefined"
    ? null
    : (globalThis._pluRedisClient ??= createRedisClient() ?? undefined) ?? null;

export async function getCache<T>(key: string): Promise<T | null> {
  if (!redisClient) return null;

  try {
    const value = await redisClient.get<T>(key);
    if (typeof value === "undefined" || value === null) return null;
    return value;
  } catch (error) {
    console.warn("[redis] getCache failed for key", key, error);
    return null;
  }
}

export async function setCache<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  if (!redisClient) return;

  try {
    await redisClient.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    console.warn("[redis] setCache failed for key", key, error);
  }
}

