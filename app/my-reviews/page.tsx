import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { DiscoveryFilters } from "@/components/catalog/discovery/DiscoveryFilters";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { requireSignedIn, readMyAccess } from "@/lib/auth/guards";
import { DANKOOK_JUKJEON } from "@/lib/data/location";
import { loadDiscoveryCatalog, parseCatalogFilters } from "@/lib/data/catalog";
import type { ReviewCardData, ReviewRow } from "@/lib/data/reviews";

export const metadata: Metadata = { title: "내 리뷰" };
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type ReviewWithMenu = { review: ReviewCardData; menuName: string };

function chunks<T>(values: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export default async function MyReviewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [{ supabase, userId }, params] = await Promise.all([
    requireSignedIn("/my-reviews"),
    searchParams,
  ]);
  const parsed = parseCatalogFilters(params);
  const filters = { ...parsed, mineReviews: true, wishlistedOnly: false };
  const [discovery, access, profileResult] = await Promise.all([
    loadDiscoveryCatalog(supabase, filters, userId, { includeInactive: true }),
    readMyAccess(supabase),
    supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
  ]);

  const menuIds = discovery.items.map((item) => Number(item.id));
  const reviewResults = await Promise.all(chunks(menuIds).map((ids) =>
    supabase
      .from("reviews")
      .select("id, user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent, created_at, updated_at")
      .eq("user_id", userId)
      .in("menu_id", ids),
  ));
  const reviewByMenuId = new Map<number, ReviewRow>();
  let loadFailed = false;
  for (const result of reviewResults) {
    if (result.error) loadFailed = true;
    for (const review of (result.data ?? []) as ReviewRow[]) {
      reviewByMenuId.set(review.menu_id, review);
    }
  }

  const displayName = profileResult.data?.display_name ?? "회원";
  const cards: ReviewWithMenu[] = discovery.items.flatMap((menu) => {
    const review = reviewByMenuId.get(Number(menu.id));
    if (!review) return [];
    return [{
      review: { ...review, reviewerName: displayName, likeCount: 0, likedByMe: false },
      menuName: `${menu.restaurant.name} · ${menu.name}`,
    }];
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <SiteHeader />
      <main style={{ width: "calc(100% - 2rem)", maxWidth: "72rem", margin: "2rem auto 4rem", display: "grid", gap: "1.2rem" }}>
        <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "end", gap: "1rem" }}>
          <div>
            <p style={{ color: "var(--accent)", fontWeight: 700, margin: 0 }}>내 기록</p>
            <h1 style={{ margin: "0.2rem 0", fontSize: "clamp(1.7rem, 5vw, 2.4rem)" }}>내 리뷰</h1>
            <p style={{ margin: 0, color: "var(--muted)" }}>내가 먹어 본 메뉴와 기록을 한곳에서 관리해요.</p>
          </div>
          <Link href="/wishlist" style={linkButton}>찜한 메뉴 보기</Link>
        </header>

        <DiscoveryFilters
          initial={filters}
          regions={discovery.regions}
          authenticated
          campus={DANKOOK_JUKJEON}
          fixedPersonalFilter="mineReviews"
          showPersonalFilters={false}
          heading="내가 리뷰한 메뉴를 찾아요"
        />

        {loadFailed ? (
          <section role="alert" style={emptyPanel}>
            <h2 style={{ margin: "0 0 0.3rem", fontSize: "1.1rem" }}>리뷰를 불러오지 못했어요</h2>
            <p style={{ margin: 0, color: "var(--muted)" }}>잠시 후 페이지를 새로고침해 주세요.</p>
          </section>
        ) : cards.length ? (
          <>
            <p style={{ margin: 0, color: "var(--muted)" }}>검색 결과 {cards.length}개</p>
            {cards.map(({ review, menuName }) => (
              <ReviewCard
                key={review.id}
                review={review}
                menuName={menuName}
                currentUserId={userId}
                isServerAdmin={access.isServerAdmin}
              />
            ))}
          </>
        ) : (
          <section style={emptyPanel}>
            <h2 style={{ margin: "0 0 0.3rem", fontSize: "1.1rem" }}>조건에 맞는 리뷰가 없어요</h2>
            <p style={{ margin: "0 0 0.8rem", color: "var(--muted)" }}>검색어나 지역·거리 조건을 바꾸거나 메뉴를 둘러보세요.</p>
            <Link href="/" style={linkButton}>메뉴 둘러보기</Link>
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
