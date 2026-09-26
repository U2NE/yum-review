import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getReviewLikeSummaries } from "@/lib/data/likes";

export type ReviewSavePayload = {
  menuId: number;
  overallScore: number;
  tasteScore: number | null;
  valueScore: number | null;
  portionScore: number | null;
  comment: string | null;
  nonEventConsent: true;
};

export type ReviewRow = {
  id: number;
  user_id: string;
  menu_id: number;
  overall_score: number;
  taste_score: number | null;
  value_score: number | null;
  portion_score: number | null;
  comment: string | null;
  non_event_review_consent: boolean | null;
  created_at: string;
  updated_at: string;
};

export type ReviewCardData = ReviewRow & {
  reviewerName: string;
  likeCount: number;
  likedByMe: boolean;
};

type SupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;

export async function fetchMenuReviews(
  supabase: SupabaseClient,
  menuId: number,
  viewerId: string | null,
): Promise<ReviewCardData[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select(
      "id, user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent, created_at, updated_at",
    )
    .eq("menu_id", menuId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new Error("리뷰를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  const rows = (data ?? []) as ReviewRow[];
  if (!rows.length) return [];

  const reviewerIds = [...new Set(rows.map((row) => row.user_id))];
  const [{ data: profiles, error: profilesError }, likeSummaries] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", reviewerIds),
    getReviewLikeSummaries(
      supabase,
      rows.map((row) => row.id),
      viewerId,
    ),
  ]);

  // Profiles do not have a declared FK to reviews, so fetch them separately and
  // expose only the public display name in the card model.
  const visibleProfiles = (profilesError ? [] : profiles ?? []) as Array<{
    user_id: string;
    display_name: string;
  }>;
  const profileNames = new Map<string, string>(
    visibleProfiles.map((profile): [string, string] => [profile.user_id, profile.display_name]),
  );

  return rows.map((row) => ({
    ...row,
    reviewerName: profileNames.get(row.user_id) ?? "회원",
    likeCount: likeSummaries.get(row.id)?.count ?? 0,
    likedByMe: likeSummaries.get(row.id)?.likedByMe ?? false,
  }));
}

export async function saveReview(
  supabase: SupabaseClient,
  userId: string,
  payload: ReviewSavePayload,
  existingReviewId?: number,
): Promise<ReviewRow> {
  if (!Number.isInteger(payload.menuId) || payload.menuId < 1) {
    throw new Error("메뉴 정보를 확인할 수 없어요.");
  }
  if (
    !Number.isFinite(payload.overallScore) ||
    payload.overallScore < 0.5 ||
    payload.overallScore > 5 ||
    payload.overallScore * 2 !== Math.trunc(payload.overallScore * 2)
  ) {
    throw new Error("전체 별점을 0.5점 단위로 선택해 주세요.");
  }
  if (payload.nonEventConsent !== true) {
    throw new Error("이벤트 참여 없이 작성한 리뷰인지 확인해 주세요.");
  }

  const comment = payload.comment?.trim() || null;
  if (comment && [...comment].length > 1000) {
    throw new Error("코멘트는 1,000자까지 입력할 수 있어요.");
  }

  const values = {
    overall_score: payload.overallScore,
    taste_score: payload.tasteScore,
    value_score: payload.valueScore,
    portion_score: payload.portionScore,
    comment,
    non_event_review_consent: true,
  };

  const result = existingReviewId
    ? await supabase
        .from("reviews")
        .update(values)
        .eq("id", existingReviewId)
        .eq("user_id", userId)
        .select(
          "id, user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent, created_at, updated_at",
        )
        .single()
    : await supabase
        .from("reviews")
        .insert({ ...values, user_id: userId, menu_id: payload.menuId })
        .select(
          "id, user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent, created_at, updated_at",
        )
        .single();

  if (result.error || !result.data) {
    if (result.error?.code === "23505") {
      throw new Error("이 메뉴에는 이미 리뷰를 작성했어요. 내 리뷰에서 수정해 주세요.");
    }
    throw new Error("리뷰를 저장하지 못했어요. 로그인 상태와 메뉴를 확인해 주세요.");
  }
  return result.data as ReviewRow;
}

export async function deleteReview(
  supabase: SupabaseClient,
  reviewId: number,
  viewerId: string,
  allowAdminDelete = false,
) {
  let query = supabase.from("reviews").delete().eq("id", reviewId);
  if (!allowAdminDelete) query = query.eq("user_id", viewerId);
  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data) {
    throw new Error("리뷰를 삭제하지 못했어요. 권한을 확인한 뒤 다시 시도해 주세요.");
  }
}
