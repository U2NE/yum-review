import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";

export type AuthEmailLookupResult =
  | { status: "allowed"; exists: boolean }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

function resolveClientAddress(request: Request): string | null {
  // Vercel documents x-real-ip as its client-IP header and overwrites the
  // corresponding forwarded IP at the edge. Never fall back to client-supplied
  // x-forwarded-for values.
  const address = request.headers.get("x-real-ip")?.trim();
  if (address && isIP(address) !== 0) return address;
  if (process.env.NODE_ENV !== "production") return "::1";
  return null;
}

export async function lookupAuthEmailStatus(request: Request, email: string): Promise<AuthEmailLookupResult> {
  const address = resolveClientAddress(request);
  if (!address) return { status: "unavailable" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) return { status: "unavailable" };

  const ipHash = createHash("sha256").update(address).digest("hex");
  try {
    const admin = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.rpc("lookup_auth_email_status", {
      p_email: email,
      p_ip_hash: ipHash,
    });
    if (error || !Array.isArray(data) || data.length !== 1) return { status: "unavailable" };

    const row = data[0] as { allowed?: unknown; email_exists?: unknown; retry_after_seconds?: unknown };
    if (row.allowed === false) {
      const retryAfterSeconds = Number(row.retry_after_seconds);
      if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 1) return { status: "unavailable" };
      return { status: "limited", retryAfterSeconds: Math.min(60, Math.ceil(retryAfterSeconds)) };
    }
    if (row.allowed === true && typeof row.email_exists === "boolean") {
      return { status: "allowed", exists: row.email_exists };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
