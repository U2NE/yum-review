import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { passwordPolicyIssue, passwordPolicyMessage } from "@/lib/auth/password-policy";
import { readBoundedJson } from "@/lib/server/read-bounded-json.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function reply(error: string, status: number, details: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...details }, { status, headers: { "Cache-Control": "no-store" } });
}

function unchangedPasswordReply(error: string, status: number) {
  return reply(error, status, { passwordUnchanged: true });
}

function uncertainPasswordUpdateReply(legacyGateConfirmed: boolean) {
  if (legacyGateConfirmed) {
    return reply(
      "비밀번호 변경 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 현재 비밀번호로 적용됐을 수 있습니다. 그 비밀번호를 현재 비밀번호로 입력하고, 이전과 다른 새 비밀번호로 다시 변경해 주세요. 변경을 확인할 때까지 계정 완료 처리는 보류됩니다.",
      503,
      { gatePending: true, outcomeUnknown: true },
    );
  }

  return reply(
    "비밀번호 변경 결과를 확인하지 못했어요. 방금 제출한 새 비밀번호가 적용됐을 수 있습니다. 새 비밀번호로 로그인되는지 확인해 주세요. 적용되지 않았다면 현재 비밀번호를 다시 입력해 변경해 주세요.",
    503,
    { outcomeUnknown: true },
  );
}

function verifiedPasswordChangeNeedsGateRecoveryReply(legacyGateConfirmed: boolean) {
  if (legacyGateConfirmed) {
    return reply(
      "비밀번호 변경은 적용됐어요. 방금 제출한 새 비밀번호를 현재 비밀번호로 입력하고, 다른 새 비밀번호로 다시 변경해 계정 완료 처리를 마쳐 주세요.",
      503,
      { passwordChanged: true, gatePending: true },
    );
  }

  return reply(
    "비밀번호 변경은 적용됐어요. 방금 제출한 새 비밀번호가 현재 비밀번호입니다. 이 비밀번호로 로그인할 수 있고, 다시 변경하려면 현재 비밀번호 입력란에 방금 제출한 비밀번호를 입력해 주세요. 계정 상태 확인은 완료하지 못했으니 잠시 후 다시 확인해 주세요.",
    503,
    { passwordChanged: true },
  );
}

function isRetryablePasswordUpdateError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; status?: unknown };
  if (candidate.name === "AuthRetryableFetchError") return true;
  return typeof candidate.status === "number" && (candidate.status === 0 || (candidate.status >= 500 && candidate.status <= 599));
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply("요청을 확인해 주세요.", 403);
  let passwordChanged = false;
  let passwordUpdateAttempted = false;
  let legacyGateConfirmed = false;
  let currentPassword: string;
  let newPassword: string;
  const parsed = await readBoundedJson(request, 4096);
  if (!parsed.ok) return reply("요청 형식이 올바르지 않습니다.", parsed.status);
  const body = parsed.value;
  if (!body || typeof body !== "object") return reply("요청 형식이 올바르지 않습니다.", 400);
  const candidate = body as { currentPassword?: unknown; newPassword?: unknown };
  if (typeof candidate.currentPassword !== "string" || typeof candidate.newPassword !== "string") {
    return reply("현재 비밀번호와 새 비밀번호를 확인해 주세요.", 400);
  }
  currentPassword = candidate.currentPassword;
  newPassword = candidate.newPassword;
  if (currentPassword.length < 1 || newPassword.length > 128) {
    return reply("현재 비밀번호와 새 비밀번호를 확인해 주세요.", 400);
  }
  const policyIssue = passwordPolicyIssue(newPassword);
  if (policyIssue) return reply(passwordPolicyMessage(policyIssue), 400);
  if (currentPassword === newPassword) return reply("현재와 다른 비밀번호를 입력해 주세요.", 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;
    if (authError || !user?.email) return reply("로그인 상태를 확인한 뒤 다시 시도해 주세요.", 401);

    // Reauthenticate this same server client so the current password is proved
    // and the resulting fresh session can perform the secure Auth update.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return unchangedPasswordReply("계정 설정을 사용할 수 없습니다.", 503);
    const { data: verified, error: credentialError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (credentialError || verified.user?.id !== user.id) return reply("현재 비밀번호가 맞지 않습니다.", 403);

    // Capture the caller's gate state before an update can have an ambiguous
    // transport result. Unknown gate state must never produce legacy-only UI.
    const { data: gateBeforeChange, error: gateBeforeChangeError } = await supabase.rpc("legacy_password_change_required");
    if (gateBeforeChangeError || typeof gateBeforeChange !== "boolean") {
      return unchangedPasswordReply("계정 상태를 확인할 수 없어 비밀번호를 변경하지 않았습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
    legacyGateConfirmed = gateBeforeChange;

    passwordUpdateAttempted = true;
    const { data: changed, error: changeError } = await supabase.auth.updateUser({ password: newPassword });
    if (changeError) {
      if (isRetryablePasswordUpdateError(changeError)) return uncertainPasswordUpdateReply(legacyGateConfirmed);
      return unchangedPasswordReply("비밀번호를 변경하지 못했습니다. 다시 시도해 주세요.", 422);
    }
    if (changed.user?.id !== user.id) return uncertainPasswordUpdateReply(legacyGateConfirmed);
    passwordChanged = true;
    passwordUpdateAttempted = false;

    const { data: mustChange, error: gateError } = await supabase.rpc("legacy_password_change_required");
    if (gateError || typeof mustChange !== "boolean") {
      return verifiedPasswordChangeNeedsGateRecoveryReply(legacyGateConfirmed);
    }
    if (mustChange === true) {
      legacyGateConfirmed = true;
      const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!secretKey) {
        return verifiedPasswordChangeNeedsGateRecoveryReply(legacyGateConfirmed);
      }
      const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: cleared, error: clearError } = await admin.rpc("clear_legacy_password_gate_after_verified_change", {
        p_user_id: user.id,
      });
      if (clearError || cleared !== true) {
        return verifiedPasswordChangeNeedsGateRecoveryReply(legacyGateConfirmed);
      }
    }

    return NextResponse.json({ changed: true, gateCleared: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    if (passwordChanged) return verifiedPasswordChangeNeedsGateRecoveryReply(legacyGateConfirmed);
    if (passwordUpdateAttempted) return uncertainPasswordUpdateReply(legacyGateConfirmed);
    return unchangedPasswordReply("비밀번호 변경을 처리하지 못했습니다. 다시 시도해 주세요.", 503);
  }
}
