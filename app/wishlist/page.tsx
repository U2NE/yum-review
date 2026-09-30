import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { DiscoveryFilters } from "@/components/catalog/discovery/DiscoveryFilters";
import { MenuCard } from "@/components/catalog/MenuCard";
import { requireSignedIn } from "@/lib/auth/guards";
import { DANKOOK_JUKJEON } from "@/lib/data/location";
import { loadDiscoveryCatalog, parseCatalogFilters } from "@/lib/data/catalog";
import styles from "@/components/auth/auth.module.css";

export const metadata: Metadata = { title: "찜한 메뉴" };
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [{ supabase, userId }, params] = await Promise.all([
    requireSignedIn("/wishlist"),
    searchParams,
  ]);
  const parsed = parseCatalogFilters(params);
  const filters = { ...parsed, mineReviews: false, wishlistedOnly: true };
  let discovery: Awaited<ReturnType<typeof loadDiscoveryCatalog>> | null = null;
  try {
    discovery = await loadDiscoveryCatalog(supabase, filters, userId);
  } catch {
    // Keep the personal page's error state in the page instead of surfacing a
    // framework error if the catalog or personalization query is unavailable.
  }

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.listPage}>
        <header className={styles.listHeader}>
          <div>
            <p className={styles.listEyebrow}>내 메뉴</p>
            <h1 className={styles.listTitle}>찜한 메뉴</h1>
            <p className={styles.listDescription}>마음에 둔 메뉴를 다시 찾아볼 수 있어요.</p>
          </div>
          <Link className={styles.listLink} href="/my-reviews">내 리뷰 보기</Link>
        </header>

        {discovery ? (
          <>
            <DiscoveryFilters
              initial={filters}
              regions={discovery.regions}
              authenticated
              campus={DANKOOK_JUKJEON}
              fixedPersonalFilter="wishlistedOnly"
              showPersonalFilters={false}
              heading="찜한 메뉴를 찾아요"
            />

            {discovery.items.length ? (
              <>
                <p className={styles.resultCount}>검색 결과 {discovery.items.length}개</p>
                <div className={styles.listGrid}>
                  {discovery.items.map((menu) => (
                    <MenuCard
                      key={menu.id}
                      menuId={Number(menu.id)}
                      name={menu.name}
                      restaurantName={menu.restaurant.name}
                      priceKrw={menu.priceKrw}
                      cuisineCategory={menu.cuisineCategory}
                      score={menu.score}
                      reviewCount={menu.reviewCount}
                      imageUrl={menu.imageUrl}
                      isWishlisted={menu.isWishlisted}
                      hasReviewed={menu.hasReviewed}
                    />
                  ))}
                </div>
              </>
            ) : (
              <section className={styles.emptyPanel}>
                <h2>조건에 맞는 찜한 메뉴가 없어요</h2>
                <p>검색어나 지역·거리 조건을 바꾸거나 새 메뉴를 찜해 보세요.</p>
                <Link className={styles.listLink} href="/">메뉴 둘러보기</Link>
              </section>
            )}
          </>
        ) : (
          <section className={styles.emptyPanel} role="alert">
            <h2>찜 목록을 불러오지 못했어요</h2>
            <p>잠시 후 페이지를 새로고침해 주세요.</p>
          </section>
        )}
      </main>
    </div>
  );
}
