import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { DiscoveryFilters } from "@/components/catalog/discovery/DiscoveryFilters";
import { MenuCard } from "@/components/catalog/MenuCard";
import { requireSignedIn } from "@/lib/auth/guards";
import { DANKOOK_JUKJEON } from "@/lib/data/location";
import { loadDiscoveryCatalog, parseCatalogFilters } from "@/lib/data/catalog";

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
    <div style={{ minHeight: "100vh" }}>
      <SiteHeader />
      <main style={{ width: "calc(100% - 2rem)", maxWidth: "72rem", margin: "2rem auto 4rem", display: "grid", gap: "1.2rem" }}>
        <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "end", gap: "1rem" }}>
          <div>
            <p style={{ color: "var(--accent)", fontWeight: 700, margin: 0 }}>내 메뉴</p>
            <h1 style={{ margin: "0.2rem 0", fontSize: "clamp(1.7rem, 5vw, 2.4rem)" }}>찜한 메뉴</h1>
            <p style={{ margin: 0, color: "var(--muted)" }}>마음에 둔 메뉴를 다시 찾아볼 수 있어요.</p>
          </div>
          <Link href="/my-reviews" style={linkButton}>내 리뷰 보기</Link>
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
                <p style={{ margin: 0, color: "var(--muted)" }}>검색 결과 {discovery.items.length}개</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))", gap: "1rem" }}>
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
              <section style={emptyPanel}>
                <h2 style={{ margin: "0 0 0.3rem", fontSize: "1.1rem" }}>조건에 맞는 찜한 메뉴가 없어요</h2>
                <p style={{ margin: "0 0 0.8rem", color: "var(--muted)" }}>검색어나 지역·거리 조건을 바꾸거나 새 메뉴를 찜해 보세요.</p>
                <Link href="/" style={linkButton}>메뉴 둘러보기</Link>
              </section>
            )}
          </>
        ) : (
          <section role="alert" style={emptyPanel}>
            <h2 style={{ margin: "0 0 0.3rem", fontSize: "1.1rem" }}>찜 목록을 불러오지 못했어요</h2>
            <p style={{ margin: 0, color: "var(--muted)" }}>잠시 후 페이지를 새로고침해 주세요.</p>
          </section>
        )}
      </main>
    </div>
  );
}

const linkButton = {
  display: "inline-flex",
  width: "fit-content",
  border: "1px solid var(--line)",
  borderRadius: "999px",
  background: "var(--surface)",
  padding: "0.5rem 0.85rem",
  textDecoration: "none",
  fontWeight: 650,
} as const;

const emptyPanel = {
  border: "1px solid var(--line)",
  borderRadius: "0.85rem",
  padding: "1.3rem",
  background: "var(--surface)",
} as const;
