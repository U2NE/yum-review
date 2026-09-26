"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { fetchMenuReviews, saveReview, type ReviewCardData, type ReviewSavePayload } from "@/lib/data/reviews";
import { ReviewCard } from "@/components/reviews/ReviewCard";
import { ReviewForm } from "@/components/reviews/ReviewForm";

export function ReviewFeed({ menuId }: { menuId: number }) {
  const router = useRouter();
  const [reviews, setReviews] = useState<ReviewCardData[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [isServerAdmin, setIsServerAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const user = userError ? null : userData.user;
      setViewerId(user?.id ?? null);

      if (user) {
        const { data } = await supabase.rpc("get_my_access");
        const row = Array.isArray(data) ? data[0] : data;
        setIsServerAdmin(
          Boolean(row && typeof row === "object" && "is_server_admin" in row && row.is_server_admin === true),
        );
      } else {
        setIsServerAdmin(false);
      }

      setReviews(await fetchMenuReviews(supabase, menuId, user?.id ?? null));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "리뷰를 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [menuId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(payload: ReviewSavePayload) {
    const supabase = createSupabaseBrowserClient();
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) {
      window.location.assign(`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      throw new Error("로그인 후 리뷰를 등록해 주세요.");
    }
    await saveReview(supabase, data.user.id, payload);
    setShowForm(false);
    await load();
    router.refresh();
  }

  const ownReview = reviews.find((review) => review.user_id === viewerId);
  const loginHref = "/login?next=" + encodeURIComponent(`/menus/${menuId}`);

  return (
    <section aria-labelledby={`reviews-${menuId}`} style={{ display: "grid", gap: "1rem", marginTop: "2rem" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.7rem" }}>
        <div>
          <h2 id={`reviews-${menuId}`} style={{ margin: 0, fontSize: "1.3rem" }}>이 메뉴의 리뷰</h2>
          <p style={{ color: "var(--muted)", margin: "0.2rem 0 0" }}>실제 먹어본 경험을 나눠 주세요.</p>
        </div>
        {!showForm && !ownReview ? (
          viewerId ? (
            <button type="button" onClick={() => setShowForm(true)} style={primaryButton}>리뷰 작성</button>
          ) : (
            <Link href={loginHref} style={primaryButton}>
              로그인하고 리뷰 작성
            </Link>
          )
        ) : null}
      </header>

      {showForm ? (
        <div style={formPanel}>
          <ReviewForm menuId={menuId} onSave={handleSave} onCancel={() => setShowForm(false)} />
        </div>
      ) : null}

      {loading ? <p role="status" style={{ color: "var(--muted)" }}>리뷰를 불러오는 중이에요…</p> : null}
      {error ? (
        <div role="alert" style={{ border: "1px solid #d9a39a", borderRadius: "0.7rem", padding: "0.8rem", background: "var(--surface)" }}>
          <p style={{ margin: "0 0 0.5rem" }}>{error}</p>
          <button type="button" onClick={() => void load()} style={secondaryButton}>다시 불러오기</button>
        </div>
      ) : null}
      {!loading && !error && reviews.length === 0 ? (
        <p style={{ margin: 0, padding: "1rem", borderRadius: "0.7rem", background: "var(--surface)", color: "var(--muted)" }}>
          아직 리뷰가 없어요. 첫 경험을 기록해 보세요.
        </p>
      ) : null}
      {!loading && !error ? reviews.map((review) => (
        <ReviewCard
          key={review.id}
          review={review}
          currentUserId={viewerId}
          isServerAdmin={isServerAdmin}
          onChanged={() => {
            void load();
            router.refresh();
          }}
        />
      )) : null}
    </section>
  );
}

const primaryButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--accent)",
  borderRadius: "999px",
  background: "var(--accent)",
  color: "white",
  padding: "0.5rem 0.9rem",
  fontWeight: 700,
  cursor: "pointer",
  textDecoration: "none",
} as const;

const secondaryButton = {
  border: "1px solid var(--line)",
  borderRadius: "999px",
  background: "var(--surface)",
  padding: "0.45rem 0.8rem",
  cursor: "pointer",
} as const;

const formPanel = {
  border: "1px solid var(--line)",
  borderRadius: "0.8rem",
  padding: "1rem",
  background: "var(--surface)",
} as const;
