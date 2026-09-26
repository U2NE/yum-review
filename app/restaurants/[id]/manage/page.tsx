import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MenuEditor, type MenuSaveInput, type MenuSaveResult } from "@/components/admin/MenuEditor";
import styles from "@/components/catalog/discovery/discovery.module.css";
import { SiteHeader } from "@/components/site/SiteHeader";
import { requireRestaurantOwner } from "@/lib/auth/guards";
import { isCuisineCategory, loadRestaurantMenus } from "@/lib/data/catalog";

export const metadata: Metadata = { title: "메뉴 관리" };
export const dynamic = "force-dynamic";

type RestaurantManagePageProps = { params: Promise<{ id: string }> };

function validRestaurantId(value: string) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export default async function RestaurantManagePage({ params }: RestaurantManagePageProps) {
  const { id } = await params;
  if (!validRestaurantId(id)) notFound();

  const { supabase, userId } = await requireRestaurantOwner(id);
  let result: Awaited<ReturnType<typeof loadRestaurantMenus>> | null = null;
  let loadError = false;
  try {
    result = await loadRestaurantMenus(supabase, id, userId, true);
  } catch {
    loadError = true;
  }
  if (!loadError && !result?.restaurant) notFound();

  async function saveMenu(input: MenuSaveInput): Promise<MenuSaveResult> {
    "use server";

    if (!input || typeof input !== "object") {
      return { ok: false, message: "메뉴 정보를 확인해 주세요." };
    }
    if (!validRestaurantId(id)) {
      return { ok: false, message: "가게 정보를 확인할 수 없어요." };
    }
    const { supabase: callerClient } = await requireRestaurantOwner(id);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const priceKrw = input.priceKrw;
    const category = typeof input.cuisineCategory === "string" ? input.cuisineCategory : "";
    const active = input.active;

    if (!name || name.length > 160 || description.length > 1000 || !isCuisineCategory(category) || typeof active !== "boolean") {
      return { ok: false, message: "메뉴 이름, 설명, 음식 종류를 확인해 주세요." };
    }
    if (priceKrw !== null && (!Number.isSafeInteger(priceKrw) || priceKrw < 0 || priceKrw > 100_000_000)) {
      return { ok: false, message: "가격은 0원 이상 100,000,000원 이하의 정수로 입력해 주세요." };
    }

    const menuValues = {
      name,
      description: description || null,
      price_krw: priceKrw,
      cuisine_category: category,
      active,
    };
    let error: { message: string } | null = null;
    let savedMenuId: number | null = null;
    if (input.id !== null) {
      if (!/^\d+$/.test(input.id) || !Number.isSafeInteger(Number(input.id)) || Number(input.id) < 1) {
        return { ok: false, message: "수정할 메뉴를 확인해 주세요." };
      }
      const update = await callerClient
        .from("menus")
        .update(menuValues)
        .eq("id", Number(input.id))
        .eq("restaurant_id", Number(id))
        .select("id")
        .maybeSingle();
      error = update.error;
      if (!error && !update.data) error = { message: "menu not found" };
      if (!error && update.data) savedMenuId = Number(update.data.id);
    } else {
      const insert = await callerClient
        .from("menus")
        .insert({ ...menuValues, restaurant_id: Number(id) })
        .select("id")
        .maybeSingle();
      error = insert.error;
      if (!error && !insert.data) error = { message: "menu not created" };
      if (!error && insert.data) savedMenuId = Number(insert.data.id);
    }

    if (error || savedMenuId === null || !Number.isSafeInteger(savedMenuId) || savedMenuId < 1) {
      return { ok: false, message: "메뉴를 저장하지 못했어요. 이름 중복이나 권한을 확인해 주세요." };
    }

    revalidatePath("/");
    revalidatePath("/restaurants/" + id);
    revalidatePath("/restaurants/" + id + "/manage");
    return {
      ok: true,
      message: input.id ? "메뉴 정보를 수정했어요." : "메뉴를 등록했어요.",
      menuId: savedMenuId,
    };
  }

  return (
    <div className={styles.detailPage}>
      <SiteHeader />
      <main className={styles.detailContent}>
        <Link className={styles.backLink} href={"/restaurants/" + id}>← 가게 정보로</Link>
        {loadError ? (
          <section className={styles.stateCard} role="alert">
            <h1>메뉴를 불러오지 못했어요.</h1>
            <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
            <Link href={"/restaurants/" + id + "/manage"}>다시 불러오기</Link>
          </section>
        ) : result?.restaurant ? (
          <>
            <section className={styles.restaurantHero}>
              <p className={styles.eyebrow}>가게 관리</p>
              <h1>{result.restaurant.name}</h1>
              <p className={styles.editorIntro}>등록된 메뉴를 만들고 수정하거나 비공개로 보관할 수 있어요.</p>
            </section>
            <section className={styles.detailSection}>
              <MenuEditor
                restaurantName={result.restaurant.name}
                menus={result.editorMenus}
                saveMenu={saveMenu}
              />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
