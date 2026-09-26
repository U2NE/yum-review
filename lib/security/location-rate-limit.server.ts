import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";

const WINDOW_SECONDS = 60;
const REQUESTS_PER_WINDOW = 20;

const FIXED_WINDOW_SCRIPT = [
  "local current = redis.call('INCR', KEYS[1])",
  "if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
  "return { current, redis.call('TTL', KEYS[1]) }",
].join("\n");

export type LocationRateLimitResult =
  | { status: "allowed"; remaining: number }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

function getLimiterEndpoint() {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!rawUrl || !token) return null;

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:"
      || !url.hostname.toLowerCase().endsWith(".upstash.io")
      || url.username
      || url.password
    ) return null;
    return { url: url.toString().replace(/\/$/, ""), token };
  } catch {
    return null;
  }
}

/**
 * Uses shared Redis state so serverless instances cannot each keep their own
 * independent quota. Missing or unavailable configuration fails closed.
 */
export async function consumeLocationSearchQuota(ip: string | null): Promise<LocationRateLimitResult> {
  const endpoint = getLimiterEndpoint();
  if (!endpoint || !ip || isIP(ip) === 0) return { status: "unavailable" };

  const identifier = createHash("sha256").update(ip).digest("hex");
  const key = `yum:location-search:v1:${identifier}`;

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        FIXED_WINDOW_SCRIPT,
        1,
        key,
        WINDOW_SECONDS,
      ]),
    });
    if (!response.ok) return { status: "unavailable" };

    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error || !Array.isArray(payload.result)) return { status: "unavailable" };
    const [count, ttl] = payload.result.map(Number);
    if (!Number.isFinite(count) || !Number.isFinite(ttl) || ttl < 0) {
      return { status: "unavailable" };
    }
    if (count > REQUESTS_PER_WINDOW) {
      return { status: "limited", retryAfterSeconds: Math.max(1, Math.min(WINDOW_SECONDS, Math.ceil(ttl))) };
    }
    return { status: "allowed", remaining: Math.max(0, REQUESTS_PER_WINDOW - count) };
  } catch {
    return { status: "unavailable" };
  }
}
