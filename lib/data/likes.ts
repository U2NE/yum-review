import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type SupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;

export type ReviewLikeSummary = { count: number; likedByMe: boolean };

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/** Public totals come from the RPC; a caller's own rows supply unlike state. */
export async function getReviewLikeSummaries(
  supabase: SupabaseClient,
  reviewIds: number[],
  viewerId: string | null,
): Promise<Map<number, ReviewLikeSummary>> {
  const ids = [...new Set(reviewIds)].filter((id) => Number.isInteger(id) && id > 0);
  const summaries = new Map<number, ReviewLikeSummary>();
  if (!ids.length) return summaries;

  for (const group of chunk(ids, 100)) {
    const { data, error } = await supabase.rpc("get_review_like_summaries", {
      p_review_ids: group,
    });
    if (error) throw new Error("좋아요 정보를 불러오지 못했어요.");

    for (const row of (data ?? []) as Array<{
      review_id: number;
      like_count: number;
    }>) {
      summaries.set(Number(row.review_id), {
        count: Number(row.like_count) || 0,
        likedByMe: false,
      });
    }
  }

  if (viewerId) {
    // review_likes RLS reveals the active viewer's own rows only. This remains
    // the authoritative source for showing an unlike action, independent of
    // the definer RPC's convenience liked_by_me field.
    for (const group of chunk(ids, 100)) {
      const { data, error } = await supabase
        .from("review_likes")
        .select("review_id")
        .eq("user_id", viewerId)
        .in("review_id", group);
      if (error) throw new Error("내 좋아요 상태를 확인하지 못했어요.");
      for (const row of data ?? []) {
        const reviewId = Number(row.review_id);
        const summary = summaries.get(reviewId) ?? { count: 0, likedByMe: false };
        summary.likedByMe = true;
        summaries.set(reviewId, summary);
      }
    }
  }

  return summaries;
}

export async function toggleReviewLike(
  supabase: SupabaseClient,
  reviewId: number,
  reviewOwnerId: string,
  viewerId: string,
  currentlyLiked: boolean,
): Promise<boolean> {
  if (!viewerId || viewerId === reviewOwnerId) {
    throw new Error("다른 사람의 리뷰에만 좋아요를 누를 수 있어요.");
  }

  if (currentlyLiked) {
    const { error } = await supabase
      .from("review_likes")
      .delete()
      .eq("review_id", reviewId)
      .eq("user_id", viewerId);
    if (error) throw new Error("좋아요를 취소하지 못했어요.");
    return false;
  }

  const { error } = await supabase
    .from("review_likes")
    .insert({ review_id: reviewId, user_id: viewerId });
  if (error && error.code !== "23505") {
    throw new Error("좋아요를 저장하지 못했어요. 로그인 상태를 확인해 주세요.");
  }
  return true;
}
