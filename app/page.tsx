import type { Metadata } from "next";
import Link from "next/link";
import { MenuCard } from "@/components/catalog/MenuCard";
import { DiscoveryFilters } from "@/components/catalog/discovery/DiscoveryFilters";
import styles from "@/components/catalog/discovery/discovery.module.css";
import { SiteHeader } from "@/components/site/SiteHeader";
import { loadDiscoveryCatalog, parseCatalogFilters } from "@/lib/data/catalog";
import { DANKOOK_JUKJEON } from "@/lib/data/location";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "메뉴 찾기" };
export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const filters = parseCatalogFilters(params);
  let catalog: Awaited<ReturnType<typeof loadDiscoveryCatalog>> | null = null;
  let authenticated = false;
  let loadError = false;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    authenticated = Boolean(authData.user);
    catalog = await loadDiscoveryCatalog(supabase, filters, authData.user?.id ?? null);
  } catch {
    loadError = true;
  }

  return (
    <div className={styles.homePage}>
      <SiteHeader />
      <main className={styles.homeContent}>
        <section className={styles.hero} aria-labelledby="home-title">
          <div>
            <p className={styles.eyebrow}>한입기록 · 메뉴 리뷰</p>
            <h1 id="home-title">먹고 싶은 메뉴를 고르고,<br />경험을 나눠요.</h1>
            <p className={styles.heroDescription}>
              가게보다 메뉴를 먼저 살펴보고, 직접 먹어본 사람들의 별점과 리뷰를 확인할 수 있어요.
            </p>
          </div>
          <div className={styles.heroAside}>
            <span className={styles.heroNumber}>{catalog?.totalMenus ?? "—"}</span>
            <span>등록 메뉴</span>
            <Link href="/">죽전캠퍼스 주변부터 보기</Link>
          </div>
        </section>

        <DiscoveryFilters
          initial={filters}
          regions={catalog?.regions ?? []}
          authenticated={authenticated}
          campus={DANKOOK_JUKJEON}
        />

        {loadError ? (
          <section className={styles.stateCard} role="alert">
            <h2>메뉴를 불러오지 못했어요.</h2>
            <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
            <Link href="/">다시 불러오기</Link>
          </section>
        ) : catalog ? (
          <section className={styles.results} aria-labelledby="results-title">
            <div className={styles.resultsHeading}>
              <div>
                <p className={styles.eyebrow}>찾은 메뉴</p>
                <h2 id="results-title">
                  {filters.q ? `“${filters.q}” 검색 결과` : filters.region || "메뉴 목록"}
                </h2>
              </div>
              <p aria-live="polite">{catalog.items.length.toLocaleString("ko-KR")}개 메뉴</p>
            </div>

            {filters.radius !== "all" && catalog.excludedWithoutCoordinates > 0 ? (
              <p className={styles.locationHint}>
                위치 정보가 없는 메뉴 {catalog.excludedWithoutCoordinates}개는 반경 계산에서 제외했어요.
              </p>
            ) : null}

            {catalog.items.length ? (
              <div className={styles.menuGrid}>
                {catalog.items.map((item) => (
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
                <h3>조건에 맞는 메뉴가 없어요.</h3>
                <p>검색어나 거리 반경을 바꾸면 다른 메뉴를 찾을 수 있어요.</p>
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
