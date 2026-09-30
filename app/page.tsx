import type { Metadata } from "next";
import Link from "next/link";
import { DiscoveryFilters } from "@/components/catalog/discovery/DiscoveryFilters";
import styles from "@/components/catalog/discovery/discovery.module.css";
import { SiteHeader } from "@/components/site/SiteHeader";
import { loadDiscoveryCatalog, parseCatalogFilters } from "@/lib/data/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "메뉴 찾기" };
export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const filters = {
    ...parseCatalogFilters(params),
    mineReviews: false,
    wishlistedOnly: false,
  };
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
          </div>
        </section>

        {catalog ? (
          <DiscoveryFilters
            initial={filters}
            regions={catalog.regions}
            authenticated={authenticated}
            showPersonalFilters={false}
            items={catalog.items.map((item) => ({
              ...item,
              restaurant: { ...item.restaurant, latitude: null, longitude: null },
            }))}
          />
        ) : null}

        {loadError ? (
          <section className={styles.stateCard} role="alert">
            <h2>메뉴를 불러오지 못했어요.</h2>
            <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
            <Link href="/">다시 불러오기</Link>
          </section>
        ) : null}
      </main>
    </div>
  );
}
