import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { OwnerAssignments, type AdminRestaurant, type AdminUser, type OwnerAssignment } from "@/components/admin/OwnerAssignments";
import { SiteHeader } from "@/components/site/SiteHeader";
import { requireServerAdmin } from "@/lib/auth/guards";
import { listAuthUserIds } from "@/lib/supabase/admin.server";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "운영자 관리" };
export const dynamic = "force-dynamic";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminPage() {
  const { supabase } = await requireServerAdmin();
  let users: AdminUser[] = [];
  let restaurants: AdminRestaurant[] = [];
  let assignments: OwnerAssignment[] = [];
  let loadError = false;

  try {
    const [userIds, restaurantResult, assignmentResult] = await Promise.all([
      listAuthUserIds(),
      supabase.from("restaurants").select("id, name").order("name"),
      supabase.rpc("admin_list_restaurant_owners"),
    ]);

    if (restaurantResult.error || assignmentResult.error) {
      loadError = true;
    } else {
      const profileRows: Array<{ user_id: string; display_name: string }> = [];
      for (let start = 0; start < userIds.length; start += 200) {
        const chunk = userIds.slice(start, start + 200);
        if (!chunk.length) continue;
        const { data, error } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", chunk);
        if (error) {
          loadError = true;
          break;
        }
        profileRows.push(...(data ?? []));
      }

      const names = new Map(profileRows.map((profile) => [profile.user_id, profile.display_name]));
      users = userIds.map((id) => ({ id, displayName: names.get(id) ?? "이름 없는 사용자" }));
      restaurants = (restaurantResult.data ?? []).map((restaurant) => ({
        id: String(restaurant.id),
        name: restaurant.name,
      }));
      const ownerRows = (assignmentResult.data ?? []) as Array<{
        user_id: string;
        restaurant_id: number | string;
      }>;
      assignments = ownerRows.map((assignment) => ({
        userId: assignment.user_id,
        restaurantId: String(assignment.restaurant_id),
      }));
    }
  } catch {
    loadError = true;
  }

  async function setRestaurantOwner(
    userId: string,
    restaurantId: string,
    isOwner: boolean,
  ): Promise<{ ok: boolean; message: string }> {
    "use server";

    const { supabase: callerClient } = await requireServerAdmin();
    if (
      !USER_ID_PATTERN.test(userId) ||
      !/^\d+$/.test(restaurantId) ||
      !Number.isSafeInteger(Number(restaurantId)) ||
      typeof isOwner !== "boolean"
    ) {
      return { ok: false, message: "선택한 사용자와 가게 정보를 확인해 주세요." };
    }

    const { error } = await callerClient.rpc("admin_set_restaurant_owner", {
      p_user_id: userId,
      p_restaurant_id: Number(restaurantId),
      p_is_owner: isOwner,
    });

    if (error) {
      return { ok: false, message: "운영자 연결을 변경하지 못했어요. 권한과 대상을 확인해 주세요." };
    }

    revalidatePath("/admin");
    return {
      ok: true,
      message: isOwner ? "가게 운영자를 연결했어요." : "가게 운영자 연결을 해제했어요.",
    };
  }

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.wideContent}>
        {loadError ? (
          <section className={styles.card}>
            <h1 className={styles.title}>운영자 관리</h1>
            <p className={styles.message} role="alert">
              관리 정보를 불러오지 못했어요. Supabase 연결과 권한을 확인해 주세요.
            </p>
          </section>
        ) : (
          <OwnerAssignments
            users={users}
            restaurants={restaurants}
            assignments={assignments}
            setOwner={setRestaurantOwner}
          />
        )}
      </main>
    </div>
  );
}
