import "server-only";

import { createClient } from "@supabase/supabase-js";

function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase 서버 관리자 설정이 필요합니다.");
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Lists UUIDs only. Auth email addresses are never returned to the app UI. */
export async function listAuthUserIds() {
  const admin = createSupabaseAdminClient();
  const userIds: string[] = [];
  const perPage = 500;
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error("사용자 목록을 불러오지 못했습니다.");

    userIds.push(...data.users.map((user) => user.id));
    if (data.users.length < perPage) break;
    page += 1;
  }

  return userIds;
}

/** Only the verification route calls these server-only, service-role RPCs. */
export async function claimMediaVerificationSlot(mediaId: string, userId: string) {
  return createSupabaseAdminClient().rpc("claim_media_verification_slot_server", {
    p_media_id: mediaId,
    p_user_id: userId,
  });
}

export async function releaseMediaVerificationSlot(mediaId: string, userId: string, leaseToken: string) {
  return createSupabaseAdminClient().rpc("release_media_verification_slot_server", {
    p_media_id: mediaId,
    p_user_id: userId,
    p_lease_token: leaseToken,
  });
}
