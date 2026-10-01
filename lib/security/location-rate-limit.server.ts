import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";

const REQUESTS_PER_WINDOW = 20;
const WINDOW_SECONDS = 60;

export type LocationRateLimitResult =
  | { status: "allowed"; remaining: number }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

function resolveClientAddress(header: string | null): string | null {
  const address = header?.trim();
  if (address && isIP(address) !== 0) return address;
  return process.env.NODE_ENV === "production" ? null : "::1";
}

/** Uses one shared Postgres bucket for both public location endpoints. */
export async function consumeLocationSearchQuota(header: string | null): Promise<LocationRateLimitResult> {
  const address = resolveClientAddress(header);
  if (!address) return { status: "unavailable" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { status: "unavailable" };

  const ipHash = createHash("sha256").update(address).digest("hex");
  try {
    const service = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await service.rpc("consume_location_search_quota", { p_ip_hash: ipHash });
    if (error || !Array.isArray(data) || data.length !== 1) return { status: "unavailable" };

    const row = data[0] as { allowed?: unknown; remaining?: unknown; retry_after_seconds?: unknown };
    if (row.allowed === true) {
      const remaining = Number(row.remaining);
      if (!Number.isInteger(remaining) || remaining < 0 || remaining >= REQUESTS_PER_WINDOW) {
        return { status: "unavailable" };
      }
      return { status: "allowed", remaining };
    }
    if (row.allowed === false) {
      const retryAfterSeconds = Number(row.retry_after_seconds);
      if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 1) return { status: "unavailable" };
      return { status: "limited", retryAfterSeconds: Math.min(WINDOW_SECONDS, Math.ceil(retryAfterSeconds)) };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
