import { NextResponse } from "next/server";
import { safeAuthReturnTo, resolveAuthSiteOrigin } from "@/lib/auth/redirect-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = resolveAuthSiteOrigin({ requestOrigin: requestUrl.origin });
  if (!origin) return new Response("인증 주소 설정을 확인해 주세요.", { status: 503 });

  const returnTo = safeAuthReturnTo(requestUrl.searchParams.get("next"));
  const code = requestUrl.searchParams.get("code")?.trim() ?? "";
  const error = requestUrl.searchParams.get("error");
  const destination = new URL(error || !code || code.length > 4096 ? "/login" : returnTo, origin);
  if (destination.origin !== origin) {
    return NextResponse.redirect(new URL("/login", origin), 303);
  }
  if (error || !code || code.length > 4096) {
    destination.searchParams.set("error", "confirmation");
    if (returnTo !== "/") destination.searchParams.set("next", returnTo);
    return NextResponse.redirect(destination, 303);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      const failed = new URL("/login", origin);
      failed.searchParams.set("error", "confirmation");
      if (returnTo !== "/") failed.searchParams.set("next", returnTo);
      return NextResponse.redirect(failed, 303);
    }
    const completed = new URL(returnTo, origin);
    if (completed.origin !== origin) {
      return NextResponse.redirect(new URL("/login?error=confirmation", origin), 303);
    }
    return NextResponse.redirect(completed, 303);
  } catch {
    const failed = new URL("/login", origin);
    failed.searchParams.set("error", "confirmation");
    if (returnTo !== "/") failed.searchParams.set("next", returnTo);
    return NextResponse.redirect(failed, 303);
  }
}
