import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readMyAccess } from "@/lib/auth/guards";
import { BrandMark } from "./BrandMark";
import { LogoutButton } from "@/components/auth/LogoutButton";
import styles from "@/components/auth/auth.module.css";

export async function SiteHeader() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  let displayName = "";
  let isServerAdmin = false;
  let ownerRestaurants: Array<{ id: string; name: string }> = [];

  if (user) {
    const [{ data: profile }, access] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      readMyAccess(supabase),
    ]);
    displayName = profile?.display_name ?? "회원";
    isServerAdmin = access.isServerAdmin;

    if (access.ownerRestaurantIds.length) {
      const { data: restaurants } = await supabase
        .from("restaurants")
        .select("id, name")
        .in("id", access.ownerRestaurantIds)
        .order("name");
      ownerRestaurants = (restaurants ?? []).map((restaurant) => ({
        id: String(restaurant.id),
        name: restaurant.name,
      }));
    }
  }

  return (
    <header className={styles.header}>
      <Link className={styles.brandLink} href="/" aria-label="한입기록 홈">
        <BrandMark />
        <span>기록</span>
      </Link>
      <nav className={styles.nav} aria-label="주요 메뉴">
        {user ? (
          <>
            <span>{displayName}님</span>
            <Link href="/account">내 계정</Link>
            {isServerAdmin ? <Link href="/admin">운영자 관리</Link> : null}
            {ownerRestaurants.length ? (
              <span className={styles.ownerLinks} aria-label="내 가게 관리">
                {ownerRestaurants.map((restaurant) => (
                  <Link key={restaurant.id} href={`/restaurants/${restaurant.id}/manage`}>
                    {restaurant.name} 관리
                  </Link>
                ))}
              </span>
            ) : null}
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/login">로그인</Link>
            <Link className={styles.button} href="/signup">회원가입</Link>
          </>
        )}
      </nav>
    </header>
  );
}
