import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Returns only the Auth UUID. Email and Auth metadata stay server-side. */
export async function getCurrentUserId() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;
  return data.user.id;
}

export async function getPublicDisplayName(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return data?.display_name ?? null;
}
