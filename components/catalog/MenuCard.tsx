"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { toggleMenuWishlist } from "@/lib/data/wishlists";
import { RefreshableImage } from "@/components/media/RefreshableImage";

export type MenuCardProps = {
  menuId: number;
  name: string;
  restaurantName: string;
  priceKrw: number | null;
  cuisineCategory: string;
  score: number | null;
  reviewCount: number;
  imageUrl: string | null;
  isWishlisted: boolean;
  hasReviewed: boolean;
};

const categoryNames: Record<string, string> = {
  KOREAN: "한식",
  WESTERN: "양식",
  CHINESE: "중식",
  JAPANESE: "일식",
  SNACK: "분식",
  PUB: "주점",
  CAFE: "카페",
  OTHER: "기타",
};

export function MenuCard({
  menuId,
  name,
  restaurantName,
  priceKrw,
  cuisineCategory,
  score,
  reviewCount,
  imageUrl,
  isWishlisted,
  hasReviewed,
}: MenuCardProps) {
  const router = useRouter();
  const [wishlisted, setWishlisted] = useState(isWishlisted);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setWishlisted(isWishlisted), [isWishlisted]);

  async function handleWishlist() {
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    setPending(true);
    try {
      const nextState = await toggleMenuWishlist(supabase, menuId, data.user.id, wishlisted);
      setWishlisted(nextState);
      router.refresh();
    } catch (wishlistError) {
      setError(wishlistError instanceof Error ? wishlistError.message : "찜을 변경하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article style={{ minWidth: 0, border: "1px solid var(--line)", borderRadius: "0.9rem", overflow: "hidden", background: "var(--surface)", display: "grid" }}>
      <Link href={`/menus/${menuId}`} aria-label={`${restaurantName} ${name} 메뉴 상세`} style={{ color: "inherit", textDecoration: "none" }}>
        <div style={{ aspectRatio: "16 / 10", background: "var(--accent-soft)", overflow: "hidden" }}>
          {imageUrl ? (
            <RefreshableImage
              src={imageUrl}
              alt={`${name} 메뉴 사진`}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              fallback={<div aria-label={`${name} 메뉴 사진을 불러올 수 없습니다`} role="img" style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: "0.92rem" }}>사진을 불러올 수 없어요</div>}
            />
          ) : (
            <div aria-label="등록된 메뉴 사진이 없습니다" role="img" style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: "0.92rem" }}>
              사진 준비 중
            </div>
          )}
        </div>
        <div style={{ padding: "0.9rem 1rem 0.45rem", display: "grid", gap: "0.15rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>{restaurantName}</span>
          <strong style={{ fontSize: "1.08rem", overflowWrap: "anywhere" }}>{name}</strong>
        </div>
      </Link>
      <div style={{ padding: "0.2rem 1rem 1rem", display: "grid", gap: "0.65rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", color: "var(--muted)", fontSize: "0.86rem" }}>
          <span>{categoryNames[cuisineCategory] ?? categoryNames.OTHER}</span>
          <span aria-hidden="true">·</span>
          <span>{priceKrw === null ? "가격 확인 중" : `${priceKrw.toLocaleString("ko-KR")}원`}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <div role="group" aria-label={score === null ? "아직 평균 별점이 없습니다" : `평균 ${score.toFixed(1)}점, 리뷰 ${reviewCount}개`} style={{ display: "grid", gap: "0.05rem" }}>
            <strong style={{ fontSize: "1.2rem" }}>{score === null ? "—" : score.toFixed(1)} <span style={{ color: "var(--accent)" }}>★</span></strong>
            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>리뷰 {reviewCount}개</span>
          </div>
          <button type="button" onClick={handleWishlist} disabled={pending} aria-pressed={wishlisted} aria-label={wishlisted ? `${name} 찜 해제` : `${name} 찜하기`} style={wishButton}>
            {pending ? "처리 중…" : wishlisted ? "♥ 찜한 메뉴" : "♡ 찜하기"}
          </button>
        </div>
        {hasReviewed ? <span style={{ color: "var(--focus)", fontSize: "0.84rem" }}>내가 리뷰한 메뉴</span> : null}
        {error ? <span role="alert" style={{ color: "#9a2e20", fontSize: "0.84rem" }}>{error}</span> : null}
      </div>
    </article>
  );
}

const wishButton = {
  border: "1px solid var(--line)",
  borderRadius: "999px",
  background: "var(--surface)",
  padding: "0.4rem 0.7rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;
