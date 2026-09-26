import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;
type WishlistedMenuRow = { menu_id: number | string };
type ActiveMenuRow = { id: number | string };

export async function getWishlistedMenuIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<number[]> {
  const { data, error } = await supabase
    .from("menu_wishlists")
    .select("menu_id")
    .eq("user_id", userId);
  if (error) throw new Error("찜한 메뉴를 불러오지 못했어요.");
  const rows = (data ?? []) as WishlistedMenuRow[];
  return rows.map((row: WishlistedMenuRow) => Number(row.menu_id)).filter(Number.isFinite);
}

export async function toggleMenuWishlist(
  supabase: SupabaseClient,
  menuId: number,
  userId: string,
  currentlyWishlisted: boolean,
): Promise<boolean> {
  if (!Number.isInteger(menuId) || menuId < 1 || !userId) {
    throw new Error("로그인 후 이용해 주세요.");
  }

  if (currentlyWishlisted) {
    const { error } = await supabase
      .from("menu_wishlists")
      .delete()
      .eq("menu_id", menuId)
      .eq("user_id", userId);
    if (error) throw new Error("찜을 해제하지 못했어요.");
    return false;
  }

  // RLS independently enforces this condition; the explicit read lets the UI
  // return a useful result if a previously active menu was unlisted.
  const { data: menuData, error: menuError } = await supabase
    .from("menus")
    .select("id")
    .eq("id", menuId)
    .eq("active", true)
    .maybeSingle();
  const menu = menuData as ActiveMenuRow | null;
  if (menuError || !menu) throw new Error("현재 찜할 수 없는 메뉴예요.");

  const { error } = await supabase
    .from("menu_wishlists")
    .insert({ menu_id: menuId, user_id: userId });
  if (error && error.code !== "23505") {
    throw new Error("찜을 저장하지 못했어요. 로그인 상태를 확인해 주세요.");
  }
  return true;
}
