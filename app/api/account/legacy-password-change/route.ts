import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readBoundedJson } from "@/lib/server/read-bounded-json.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function reply(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply("요청을 확인해 주세요.", 403);
  let currentPassword: string;
  let newPassword: string;
  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return reply("요청 형식이 올바르지 않습니다.", parsed.status);
  const body = parsed.value;
  if (!body || typeof body !== "object") return reply("요청 형식이 올바르지 않습니다.", 400);
  currentPassword = String((body as { currentPassword?: unknown }).currentPassword ?? "");
  newPassword = String((body as { newPassword?: unknown }).newPassword ?? "");
  if (currentPassword.length < 1 || newPassword.length < 8 || newPassword.length > 128) {
    return reply("현재 비밀번호와 8자 이상인 새 비밀번호를 입력해 주세요.", 400);
  }
  if (currentPassword === newPassword) return reply("현재와 다른 비밀번호를 입력해 주세요.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;
    if (authError || !user?.email) return reply("로그인 상태를 확인한 뒤 다시 시도해 주세요.", 401);

    // Reauthenticate this same server client so the current password is proved
    // and the resulting fresh session can perform the secure Auth update.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return reply("계정 설정을 사용할 수 없습니다.", 503);
    const { data: verified, error: credentialError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (credentialError || verified.user?.id !== user.id) return reply("현재 비밀번호가 맞지 않습니다.", 403);

    const { data: changed, error: changeError } = await supabase.auth.updateUser({ password: newPassword });
    if (changeError || changed.user?.id !== user.id) return reply("비밀번호를 변경하지 못했습니다. 다시 시도해 주세요.", 422);

    const { data: mustChange, error: gateError } = await supabase.rpc("legacy_password_change_required");
    if (gateError) return reply("비밀번호는 변경했지만 계정 상태를 확인하지 못했습니다. 다시 요청해 주세요.", 503);
    if (mustChange === true) {
      const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!secretKey) return reply("비밀번호는 변경했지만 완료 처리를 할 수 없습니다. 서버 설정을 확인해 주세요.", 503);
      const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: cleared, error: clearError } = await admin.rpc("clear_legacy_password_gate_after_verified_change", {
        p_user_id: user.id,
      });
      if (clearError || cleared !== true) return reply("비밀번호는 변경했지만 완료 처리를 확인하지 못했습니다. 새 비밀번호로 다시 진행해 주세요.", 503);
    }

    return NextResponse.json({ changed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return reply("비밀번호 변경을 처리하지 못했습니다. 다시 시도해 주세요.", 503);
  }
}
