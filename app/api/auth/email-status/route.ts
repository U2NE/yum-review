import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/server/read-bounded-json.server";
import { lookupAuthEmailStatus } from "@/lib/security/auth-rate-limit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: Record<string, unknown>, status: number, headers: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      return reply({ error: "요청을 확인해 주세요." }, 403);
    }

    const parsed = await readBoundedJson(request, 2048);
    if (!parsed.ok) return reply({ error: "이메일을 확인해 주세요." }, parsed.status);
    if (!parsed.value || typeof parsed.value !== "object") return reply({ error: "이메일을 확인해 주세요." }, 400);

    const rawEmail = (parsed.value as { email?: unknown }).email;
    if (typeof rawEmail !== "string") return reply({ error: "이메일을 확인해 주세요." }, 400);
    const email = rawEmail.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "이메일 주소를 확인해 주세요." }, 400);
    }

    const result = await lookupAuthEmailStatus(request, email);
    if (result.status === "limited") {
      return reply(
        { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        429,
        { "Retry-After": String(result.retryAfterSeconds) },
      );
    }
    if (result.status === "unavailable") {
      return reply({ error: "이메일 확인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
    }
    return reply({ exists: result.exists }, 200);
  } catch {
    return reply({ error: "이메일 확인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}
