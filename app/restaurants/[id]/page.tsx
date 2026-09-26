import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuCard } from "@/components/catalog/MenuCard";
import styles from "@/components/catalog/discovery/discovery.module.css";
import { SiteHeader } from "@/components/site/SiteHeader";
import { readMyAccess } from "@/lib/auth/guards";
import { loadRestaurantMenus } from "@/lib/data/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RestaurantPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: RestaurantPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: /^\d+$/.test(id) ? "가게 정보" : "가게를 찾을 수 없어요" };
}

export default async function RestaurantPage({ params }: RestaurantPageProps) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) notFound();

  let result: Awaited<ReturnType<typeof loadRestaurantMenus>> | null = null;
  let canManage = false;
  let loadError = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id ?? null;
    if (userId) {
      const access = await readMyAccess(supabase);
      canManage = access.isServerAdmin || access.ownerRestaurantIds.includes(id);
    }
    result = await loadRestaurantMenus(supabase, id, userId);
  } catch {
    loadError = true;
  }

  if (!loadError && !result?.restaurant) notFound();

  return (
    <div className={styles.detailPage}>
      <SiteHeader />
      <main className={styles.detailContent}>
        <Link className={styles.backLink} href="/">← 메뉴 목록으로</Link>
        {loadError ? (
          <section className={styles.stateCard} role="alert">
            <h1>가게 정보를 불러오지 못했어요.</h1>
            <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
            <Link href={"/restaurants/" + id}>다시 불러오기</Link>
          </section>
        ) : result?.restaurant ? (
          <>
            <section className={styles.restaurantHero} aria-labelledby="restaurant-name">
              <p className={styles.eyebrow}>가게 정보</p>
              <h1 id="restaurant-name">{result.restaurant.name}</h1>
              {result.restaurant.description ? <p className={styles.detailDescription}>{result.restaurant.description}</p> : null}
              <p className={styles.detailMeta}>
                {result.restaurant.region ? <span>{result.restaurant.region}</span> : null}
                {result.restaurant.address ? <span>{result.restaurant.address}</span> : null}
              </p>
            </section>

            <section className={styles.detailSection} aria-labelledby="restaurant-menus-title">
              <div className={styles.detailSectionHeading}>
                <div>
                  <p className={styles.eyebrow}>메뉴</p>
                  <h2 id="restaurant-menus-title">이 가게의 메뉴</h2>
                </div>
                {canManage ? (
                  <Link className={styles.restaurantManageLink} href={"/restaurants/" + id + "/manage"}>
                    메뉴 관리
                  </Link>
                ) : null}
              </div>

              {result.items.length ? (
                <div className={styles.menuGrid}>
                  {result.items.map((item) => (
                    <MenuCard
                      key={item.id}
                      menuId={Number(item.id)}
                      name={item.name}
                      restaurantName={item.restaurant.name}
                      priceKrw={item.priceKrw}
                      cuisineCategory={item.cuisineCategory}
                      score={item.score}
                      reviewCount={item.reviewCount}
                      imageUrl={item.imageUrl}
                      isWishlisted={item.isWishlisted}
                      hasReviewed={item.hasReviewed}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.stateCard}>
                  <h3>공개된 메뉴가 아직 없어요.</h3>
                  <p>메뉴 정보가 등록되면 이곳에서 확인할 수 있어요.</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
