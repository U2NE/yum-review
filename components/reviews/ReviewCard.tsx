"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { deleteReview, saveReview, type ReviewCardData } from "@/lib/data/reviews";
import { toggleReviewLike } from "@/lib/data/likes";
import { getReviewPhotoPreviews, type MediaPreview } from "@/lib/data/media";
import { ImageUpload } from "@/components/media/ImageUpload";
import { RefreshableImage } from "@/components/media/RefreshableImage";
import { ReviewForm } from "@/components/reviews/ReviewForm";

type ReviewCardProps = {
  review: ReviewCardData;
  menuName?: string;
  currentUserId: string | null;
  isServerAdmin?: boolean;
  onChanged?: () => void;
};

const starPath = "M12 2.4 14.9 8.3l6.5.9-4.7 4.6 1.1 6.5L12 17.2l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.4Z";

type ReviewPhotoPreviewRequest = {
  promise: Promise<MediaPreview[]>;
  failedMediaIds: Set<string>;
};

type ScopedReviewPhotoPreviews = {
  scopeKey: string;
  previews: MediaPreview[] | null;
};

const reviewPhotoPreviewRequests = new Map<string, ReviewPhotoPreviewRequest>();

function loadReviewPhotoPreviews(
  reviewId: number,
  currentUserId: string,
  failedMediaId?: string,
): ReviewPhotoPreviewRequest {
  const requestKey = `${reviewId}:${currentUserId}`;
  const inFlight = reviewPhotoPreviewRequests.get(requestKey);
  if (inFlight) {
    if (failedMediaId) inFlight.failedMediaIds.add(failedMediaId);
    return inFlight;
  }

  const request: ReviewPhotoPreviewRequest = {
    promise: getReviewPhotoPreviews(createSupabaseBrowserClient(), reviewId),
    failedMediaIds: new Set(failedMediaId ? [failedMediaId] : []),
  };
  reviewPhotoPreviewRequests.set(requestKey, request);
  void request.promise.finally(() => {
    if (reviewPhotoPreviewRequests.get(requestKey) === request) {
      reviewPhotoPreviewRequests.delete(requestKey);
    }
  }).catch(() => undefined);
  return request;
}

function preserveFailedReviewPhotoSlots(
  previous: MediaPreview[],
  refreshed: MediaPreview[],
  failedMediaIds: Set<string>,
): MediaPreview[] {
  const refreshedIds = new Set(refreshed.map((preview) => preview.id));
  const retained = [...failedMediaIds]
    .filter((id) => !refreshedIds.has(id))
    .map((id) => ({ id, previousIndex: previous.findIndex((preview) => preview.id === id) }))
    .filter((entry) => entry.previousIndex >= 0)
    .sort((left, right) => left.previousIndex - right.previousIndex);
  if (!retained.length) return refreshed;

  const merged = [...refreshed];
  for (const entry of retained) {
    const nextPriorId = previous
      .slice(entry.previousIndex + 1)
      .find((preview) => merged.some((candidate) => candidate.id === preview.id));
    if (nextPriorId) {
      const nextIndex = merged.findIndex((preview) => preview.id === nextPriorId.id);
      merged.splice(nextIndex, 0, previous[entry.previousIndex]);
      continue;
    }

    const previousPriorId = [...previous.slice(0, entry.previousIndex)]
      .reverse()
      .find((preview) => merged.some((candidate) => candidate.id === preview.id));
    if (previousPriorId) {
      const previousIndex = merged.findIndex((preview) => preview.id === previousPriorId.id);
      merged.splice(previousIndex + 1, 0, previous[entry.previousIndex]);
      continue;
    }

    merged.push(previous[entry.previousIndex]);
  }
  return merged;
}

function ReadOnlyScore({ score }: { score: number }) {
  return (
    <span role="img" aria-label={`${score.toFixed(1)}점`} style={{ display: "inline-flex", alignItems: "center", gap: "0.1rem" }}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, score - index));
        return (
          <span key={index} style={{ position: "relative", width: "1.1rem", height: "1.1rem", display: "inline-block" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "1.1rem", height: "1.1rem", position: "absolute" }}>
              <path d={starPath} fill="#e4ddd2" stroke="#a99f91" strokeWidth="0.5" />
            </svg>
            <span aria-hidden="true" style={{ position: "absolute", inset: "0 auto auto 0", width: `${fill * 1.1}rem`, height: "1.1rem", overflow: "hidden" }}>
              <svg viewBox="0 0 24 24" style={{ width: "1.1rem", height: "1.1rem", maxWidth: "none" }}>
                <path d={starPath} fill="#a7472c" stroke="#7e321f" strokeWidth="0.5" />
              </svg>
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function ReviewCard({ review, menuName, currentUserId, isServerAdmin = false, onChanged }: ReviewCardProps) {
  const [current, setCurrent] = useState(review);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwnReview = currentUserId === current.user_id;
  const canDelete = isOwnReview || isServerAdmin;
  const photoScopeKey = `${review.id}:${currentUserId ?? ""}`;
  const [scopedPhotoPreviewState, setScopedPhotoPreviewState] = useState<ScopedReviewPhotoPreviews | null>(null);
  // Derive visibility during render so a new review/viewer scope cannot briefly
  // display the previous scope's photos while the passive effect is pending.
  const publicPhotoPreviews = scopedPhotoPreviewState?.scopeKey === photoScopeKey
    ? scopedPhotoPreviewState.previews
    : null;
  const photoRefreshScope = useRef<string | null>(null);
  const appliedPhotoPreviewRequests = useRef(new WeakSet<ReviewPhotoPreviewRequest>());

  const refreshPublicPhotoPreviews = useCallback(async (failedMediaId?: string) => {
    if (isOwnReview || !currentUserId) return;
    const requestScope = photoScopeKey;
    const request = loadReviewPhotoPreviews(review.id, currentUserId, failedMediaId);
    try {
      const previews = await request.promise;
      if (photoRefreshScope.current !== requestScope || appliedPhotoPreviewRequests.current.has(request)) return;
      appliedPhotoPreviewRequests.current.add(request);
      setScopedPhotoPreviewState((previous) => {
        const sameScopePreviews = previous?.scopeKey === requestScope ? previous.previews ?? [] : [];
        const nextPreviews = request.failedMediaIds.size
          ? preserveFailedReviewPhotoSlots(sameScopePreviews, previews, request.failedMediaIds)
          : previews;
        return { scopeKey: requestScope, previews: nextPreviews };
      });
    } catch {
      if (photoRefreshScope.current !== requestScope || appliedPhotoPreviewRequests.current.has(request)) return;
      appliedPhotoPreviewRequests.current.add(request);
      setScopedPhotoPreviewState((previous) => {
        const sameScopePreviews = previous?.scopeKey === requestScope ? previous.previews ?? [] : [];
        const nextPreviews = request.failedMediaIds.size
          ? sameScopePreviews.filter((preview) => request.failedMediaIds.has(preview.id))
          : [];
        return { scopeKey: requestScope, previews: nextPreviews };
      });
    }
  }, [currentUserId, isOwnReview, photoScopeKey, review.id]);

  useEffect(() => {
    if (isOwnReview) {
      photoRefreshScope.current = null;
      setScopedPhotoPreviewState(null);
      return;
    }

    if (!currentUserId) {
      photoRefreshScope.current = null;
      setScopedPhotoPreviewState({ scopeKey: photoScopeKey, previews: [] });
      return;
    }

    photoRefreshScope.current = photoScopeKey;
    setScopedPhotoPreviewState((previous) => (
      previous?.scopeKey === photoScopeKey ? previous : { scopeKey: photoScopeKey, previews: null }
    ));
    void refreshPublicPhotoPreviews();
    return () => {
      if (photoRefreshScope.current === photoScopeKey) photoRefreshScope.current = null;
    };
  }, [currentUserId, isOwnReview, photoScopeKey, refreshPublicPhotoPreviews]);

  async function handleSave(payload: Parameters<typeof saveReview>[2]) {
    if (!currentUserId || !isOwnReview) throw new Error("내 리뷰만 수정할 수 있어요.");
    const saved = await saveReview(createSupabaseBrowserClient(), currentUserId, payload, current.id);
    setCurrent((existing) => ({ ...existing, ...saved }));
    setEditing(false);
    setError(null);
    onChanged?.();
  }

  async function handleDelete() {
    const prompt = isOwnReview
      ? "이 리뷰를 삭제할까요? 삭제한 리뷰는 복구할 수 없어요."
      : "운영자 권한으로 이 리뷰를 삭제할까요? 삭제한 리뷰는 복구할 수 없어요.";
    if (!window.confirm(prompt)) return;

    setPending(true);
    setError(null);
    try {
      if (!currentUserId) throw new Error("로그인 상태를 확인해 주세요.");
      await deleteReview(createSupabaseBrowserClient(), current.id, currentUserId, isServerAdmin && !isOwnReview);
      setRemoved(true);
      onChanged?.();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "리뷰를 삭제하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  async function handleLike() {
    if (!currentUserId) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const likedByMe = await toggleReviewLike(
        createSupabaseBrowserClient(),
        current.id,
        current.user_id,
        currentUserId,
        current.likedByMe,
      );
      setCurrent((existing) => ({
        ...existing,
        likedByMe,
        likeCount: Math.max(0, existing.likeCount + (likedByMe ? 1 : -1)),
      }));
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : "좋아요를 변경하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  const optionalScores = [
    ["맛", current.taste_score],
    ["가성비", current.value_score],
    ["양", current.portion_score],
  ] as const;

  if (removed) return null;

  return (
    <article style={{ border: "1px solid var(--line)", borderRadius: "0.8rem", padding: "1rem", background: "var(--surface)", display: "grid", gap: "0.8rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "0.25rem" }}>
          {menuName ? <Link href={`/menus/${current.menu_id}`} style={{ fontWeight: 700 }}>{menuName}</Link> : null}
          <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{current.reviewerName} · {new Date(current.created_at).toLocaleDateString("ko-KR")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <ReadOnlyScore score={Number(current.overall_score)} />
          <strong>{Number(current.overall_score).toFixed(1)}</strong>
        </div>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        {optionalScores.map(([label, value]) => (
          <span key={label} style={{ borderRadius: "999px", background: "var(--paper)", padding: "0.2rem 0.65rem", fontSize: "0.86rem", color: "var(--muted)" }}>
            {label} {value === null ? "미평가" : `${Number(value).toFixed(1)}점`}
          </span>
        ))}
      </div>

      {current.comment ? <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{current.comment}</p> : <p style={{ margin: 0, color: "var(--muted)" }}>남긴 코멘트가 없어요.</p>}

      {isOwnReview ? (
        <ImageUpload kind="REVIEW" reviewId={current.id} />
      ) : publicPhotoPreviews?.length ? (
          <section aria-label="리뷰 사진" style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
          {publicPhotoPreviews.map((photo) => (
            <RefreshableImage
              key={photo.id}
              src={photo.url}
              alt="리뷰 사진"
              loading="lazy"
              style={{ width: "min(12rem, 44vw)", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "0.7rem", border: "1px solid var(--line)" }}
              fallback={<div role="img" aria-label="리뷰 사진을 불러올 수 없습니다" style={{ width: "min(12rem, 44vw)", aspectRatio: "4 / 3", display: "grid", placeItems: "center", borderRadius: "0.7rem", border: "1px solid var(--line)", background: "var(--paper)", color: "var(--muted)", fontSize: "0.86rem" }}>사진을 불러올 수 없어요</div>}
              onRefresh={() => refreshPublicPhotoPreviews(photo.id)}
            />
          ))}
        </section>
      ) : null}

      {editing ? (
        <ReviewForm
          menuId={current.menu_id}
          initialReview={current}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.55rem" }}>
          {isOwnReview ? (
            <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>내 리뷰에는 좋아요를 누를 수 없어요.</span>
          ) : (
            <button type="button" onClick={handleLike} disabled={pending} aria-pressed={current.likedByMe} style={smallButton}>
              {current.likedByMe ? "♥ 좋아요 취소" : "♡ 도움이 됐어요"} · {current.likeCount}
            </button>
          )}
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {isOwnReview ? <button type="button" disabled={pending} onClick={() => setEditing(true)} style={smallButton}>수정</button> : null}
            {canDelete ? <button type="button" disabled={pending} onClick={handleDelete} style={smallButton}>{pending ? "처리 중…" : "삭제"}</button> : null}
          </div>
        </footer>
      )}
      {error ? <p role="alert" style={{ color: "#9a2e20", margin: 0 }}>{error}</p> : null}
    </article>
  );
}

const smallButton = {
  border: "1px solid var(--line)",
  borderRadius: "999px",
  background: "var(--surface)",
  padding: "0.35rem 0.75rem",
  cursor: "pointer",
} as const;
