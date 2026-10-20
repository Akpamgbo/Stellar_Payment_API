import { connectRedisClient } from "./redis.js";

const USAGE_KEY_PREFIX = "merchant:usage";
const USAGE_KEY_TTL_SECONDS = 60 * 60 * 24 * 400; // ~13 months

function toUsageMonth(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normaliseEndpointPath(pathname) {
  // Avoid exploding cardinality when IDs appear in paths.
  return pathname
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      ":id",
    )
    .replace(/\/[0-9]{2,}(?=\/|$)/g, "/:id")
    .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/:id");
}

function endpointLabelFromRequest(req) {
  const method = (req.method || "GET").toUpperCase();
  const original = req.originalUrl || req.url || "/";
  const pathOnly = original.split("?")[0] || "/";
  return `${method} ${normaliseEndpointPath(pathOnly)}`;
}

function usageKey(merchantId, month) {
  return `${USAGE_KEY_PREFIX}:${merchantId}:${month}`;
}

export async function recordMerchantApiUsage({
  merchantId,
  req,
  now = new Date(),
  redisClient,
}) {
  if (!merchantId || !req) return;

  const client = redisClient || (await connectRedisClient());
  const month = toUsageMonth(now);
  const key = usageKey(merchantId, month);
  const endpoint = endpointLabelFromRequest(req);

  await client.hIncrBy(key, endpoint, 1);
  await client.expire(key, USAGE_KEY_TTL_SECONDS);
}

function monthFromUsageKey(key) {
  return key.split(":").pop();
}

async function scanKeysByPattern(client, pattern) {
  const keys = [];

  for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
    keys.push(key);
  }

  return keys;
}

export async function getMerchantApiUsage({
  merchantId,
  month,
  redisClient,
}) {
  const client = redisClient || (await connectRedisClient());

  const keys = month
    ? [usageKey(merchantId, month)]
    : await scanKeysByPattern(client, `${USAGE_KEY_PREFIX}:${merchantId}:*`);

  const entries = [];

  for (const key of keys) {
    const counters = await client.hGetAll(key);
    const endpointUsage = Object.entries(counters)
      .map(([endpoint, hits]) => ({ endpoint, hits: Number(hits) || 0 }))
      .sort((a, b) => b.hits - a.hits || a.endpoint.localeCompare(b.endpoint));

    const total_hits = endpointUsage.reduce((sum, item) => sum + item.hits, 0);

    entries.push({
      month: monthFromUsageKey(key),
      total_hits,
      endpoints: endpointUsage,
    });
  }

  entries.sort((a, b) => b.month.localeCompare(a.month));

  return {
    merchant_id: merchantId,
    usage: entries,
  };
}

export const __testUtils = {
  toUsageMonth,
  normaliseEndpointPath,
  endpointLabelFromRequest,
  usageKey,
};
