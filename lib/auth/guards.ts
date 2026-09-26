import "server-only";

import { redirect } from "next/navigation";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServerClient as makeServerClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type UserAccess = {
  isServerAdmin: boolean;
  ownerRestaurantIds: string[];
};

export async function readMyAccess(supabase: ServerSupabase): Promise<UserAccess> {
  const { data, error } = await supabase.rpc("get_my_access");
  if (error) return { isServerAdmin: false, ownerRestaurantIds: [] };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { isServerAdmin: false, ownerRestaurantIds: [] };
  }

  const access = row as {
    is_server_admin?: unknown;
    owner_restaurant_ids?: unknown;
  };

  return {
    isServerAdmin: access.is_server_admin === true,
    ownerRestaurantIds: Array.isArray(access.owner_restaurant_ids)
      ? access.owner_restaurant_ids
          .map((id) => String(id))
          .filter((id) => /^\d+$/.test(id))
      : [],
  };
}

export async function requireSignedIn(
  returnTo = "/account",
  options: { allowForcedPasswordChange?: boolean } = {},
) {
  const supabase = await makeServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }

  if (!options.allowForcedPasswordChange) {
    const { data: mustChange, error: gateError } = await supabase.rpc("legacy_password_change_required");
    if (gateError || mustChange === true) {
      redirect(`/account/force-password-change?next=${encodeURIComponent(returnTo)}`);
    }
  }

  return { supabase, userId: data.user.id };
}

export async function requireServerAdmin() {
  const { supabase, userId } = await requireSignedIn("/admin");
  const access = await readMyAccess(supabase);

  if (!access.isServerAdmin) redirect("/");
  return { supabase, userId, access };
}

export async function requireRestaurantOwner(restaurantId: string) {
  const { supabase, userId } = await requireSignedIn(
    `/restaurants/${encodeURIComponent(restaurantId)}/manage`,
  );
  const access = await readMyAccess(supabase);

  if (
    !/^\d+$/.test(restaurantId) ||
    (!access.isServerAdmin && !access.ownerRestaurantIds.includes(restaurantId))
  ) {
    redirect("/");
  }

  return { supabase, userId, access };
}
