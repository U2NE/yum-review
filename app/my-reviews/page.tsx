import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { DiscoveryFilters } from "@/components/catalog/discovery/DiscoveryFilters";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { requireSignedIn, readMyAccess } from "@/lib/auth/guards";
import { DANKOOK_JUKJEON } from "@/lib/data/location";
import { loadDiscoveryCatalog, parseCatalogFilters } from "@/lib/data/catalog";
import type { ReviewCardData, ReviewRow } from "@/lib/data/reviews";
import styles from "@/components/auth/auth.module.css";

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
      .select("id, user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, created_at, updated_at")
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
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.listPage}>
        <header className={styles.listHeader}>
          <div>
            <p className={styles.listEyebrow}>내 기록</p>
            <h1 className={styles.listTitle}>내 리뷰</h1>
            <p className={styles.listDescription}>내가 먹어 본 메뉴와 기록을 한곳에서 관리해요.</p>
          </div>
          <Link className={styles.listLink} href="/wishlist">찜한 메뉴 보기</Link>
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
          <section className={styles.emptyPanel} role="alert">
            <h2>리뷰를 불러오지 못했어요</h2>
            <p>잠시 후 페이지를 새로고침해 주세요.</p>
          </section>
        ) : cards.length ? (
          <>
            <p className={styles.resultCount}>검색 결과 {cards.length}개</p>
            <div className={styles.reviewList}>
              {cards.map(({ review, menuName }) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  menuName={menuName}
                  currentUserId={userId}
                  isServerAdmin={access.isServerAdmin}
                />
              ))}
            </div>
          </>
        ) : (
          <section className={styles.emptyPanel}>
            <h2>조건에 맞는 리뷰가 없어요</h2>
            <p>검색어나 지역·거리 조건을 바꾸거나 메뉴를 둘러보세요.</p>
            <Link className={styles.listLink} href="/">메뉴 둘러보기</Link>
          </section>
        )}
      </main>
    </div>
  );
}
