import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewFeed } from "@/components/reviews/ReviewFeed";
import { RefreshableImage } from "@/components/media/RefreshableImage";
import styles from "@/components/catalog/discovery/discovery.module.css";
import { SiteHeader } from "@/components/site/SiteHeader";
import { loadMenuById } from "@/lib/data/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MenuPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: MenuPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: /^\d+$/.test(id) ? "메뉴 정보" : "메뉴를 찾을 수 없어요" };
}

export default async function MenuPage({ params }: MenuPageProps) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) notFound();

  let menu: Awaited<ReturnType<typeof loadMenuById>> | null = null;
  let loadError = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    menu = await loadMenuById(supabase, id, authData.user?.id ?? null);
  } catch {
    loadError = true;
  }
  if (!loadError && !menu) notFound();

  return (
    <div className={styles.detailPage}>
      <SiteHeader />
      <main className={styles.detailContent}>
        <Link className={styles.backLink} href={menu ? "/restaurants/" + menu.restaurantId : "/"}>
          ← {menu?.restaurant.name ?? "메뉴 목록"}으로
        </Link>
        {loadError ? (
          <section className={styles.stateCard} role="alert">
            <h1>메뉴 정보를 불러오지 못했어요.</h1>
            <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
            <Link href={"/menus/" + id}>다시 불러오기</Link>
          </section>
        ) : menu ? (
          <>
            <article className={styles.menuDetailCard}>
              {menu.imageUrl ? (
                <RefreshableImage
                  className={styles.menuPhoto}
                  src={menu.imageUrl}
                  alt={menu.name + " 메뉴 사진"}
                  fallback={<div className={styles.menuPhotoPlaceholder} role="img" aria-label={menu.name + " 메뉴 사진을 불러올 수 없습니다"}>사진을 불러올 수 없어요</div>}
                />
              ) : (
                <div className={styles.menuPhotoPlaceholder} role="img" aria-label="등록된 메뉴 사진이 없습니다">
                  사진 준비 중
                </div>
              )}
              <div className={styles.menuDetailInfo}>
                <p className={styles.eyebrow}>{menu.active ? "메뉴 상세" : "비공개 메뉴"}</p>
                <Link className={styles.menuRestaurantLink} href={"/restaurants/" + menu.restaurantId}>
                  {menu.restaurant.name}
                </Link>
                <h1>{menu.name}</h1>
                {menu.description ? <p className={styles.detailDescription}>{menu.description}</p> : null}
                <p className={styles.menuDetailPrice}>
                  {menu.priceKrw === null ? "가격 확인 중" : menu.priceKrw.toLocaleString("ko-KR") + "원"}
                </p>
                <div className={styles.ratingSummary} aria-label="메뉴 평점 요약">
                  <div>
                    <span>전체 평점 · 리뷰 {menu.reviewCount}개</span>
                    <strong>{menu.score === null ? "미평가" : menu.score.toFixed(1) + "점"}</strong>
                  </div>
                  <div><span>맛</span><strong>{menu.tasteScore === null ? "미평가" : menu.tasteScore.toFixed(1) + "점"}</strong></div>
                  <div><span>가성비</span><strong>{menu.valueScore === null ? "미평가" : menu.valueScore.toFixed(1) + "점"}</strong></div>
                  <div><span>양</span><strong>{menu.portionScore === null ? "미평가" : menu.portionScore.toFixed(1) + "점"}</strong></div>
                </div>
              </div>
            </article>
            {menu.active ? <ReviewFeed menuId={Number(menu.id)} /> : (
              <div className={styles.stateCard} role="status" style={{ marginTop: "1rem" }}>
                이 메뉴는 현재 공개되지 않아 리뷰를 확인하거나 작성할 수 없어요.
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
