import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const BUCKET = "yum-review-media";
const SIGNED_READ_TTL_SECONDS = 60 * 60;
type BrowserSupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;

export type MediaPreview = {
  id: string;
  url: string;
  mediaKind: "MENU" | "REVIEW";
  contentType: string;
};

type MediaAssetRow = {
  id: string;
  object_path: string;
  media_kind: "MENU" | "REVIEW";
  content_type: string;
};

type ReviewPhotoLinkRow = {
  media_id: string;
  sort_order: number;
};

/**
 * Signed URLs are valid for one hour. Storage RLS checks ACTIVE plus a current
 * menu or review link when each URL is minted; an already-issued URL may still
 * work until its expiry after a detach. Long-lived-page URL refresh is not
 * provided by this server-side data helper.
 */
export async function getMediaPreviews(
  supabase: BrowserSupabaseClient,
  mediaIds: string[],
): Promise<MediaPreview[]> {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("media_assets")
    .select("id, object_path, media_kind, content_type")
    .in("id", ids);
  if (error || !data) return [];

  const assets = data as MediaAssetRow[];
  const signed = await Promise.all(assets.map(async (asset) => {
    const { data: signedData, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(asset.object_path, SIGNED_READ_TTL_SECONDS);
    if (signedError || !signedData?.signedUrl) return null;
    return {
      id: asset.id,
      url: signedData.signedUrl,
      mediaKind: asset.media_kind,
      contentType: asset.content_type,
    } satisfies MediaPreview;
  }));

  return signed.filter((entry): entry is MediaPreview => entry !== null);
}

export async function getMenuPhotoPreview(
  supabase: BrowserSupabaseClient,
  menuId: number,
): Promise<MediaPreview | null> {
  const { data, error } = await supabase
    .from("menus")
    .select("photo_media_id")
    .eq("id", menuId)
    .maybeSingle();
  if (error || !data?.photo_media_id) return null;
  return (await getMediaPreviews(supabase, [data.photo_media_id]))[0] ?? null;
}

export async function getReviewPhotoPreviews(
  supabase: BrowserSupabaseClient,
  reviewId: number,
): Promise<MediaPreview[]> {
  const { data, error } = await supabase
    .from("review_photos")
    .select("media_id, sort_order")
    .eq("review_id", reviewId)
    .order("sort_order", { ascending: true });
  if (error || !data?.length) return [];
  const rows = data as ReviewPhotoLinkRow[];
  const previews = await getMediaPreviews(supabase, rows.map((row) => row.media_id));
  const byId = new Map(previews.map((preview) => [preview.id, preview]));
  return rows.flatMap((row) => {
    const preview = byId.get(row.media_id);
    return preview ? [preview] : [];
  });
}

export async function attachMenuPhoto(
  supabase: BrowserSupabaseClient,
  menuId: number,
  mediaId: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from("menus")
    .update({ photo_media_id: mediaId })
    .eq("id", menuId)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("메뉴 사진을 연결하지 못했어요. 메뉴 관리 권한을 확인해 주세요.");
}

export async function attachReviewPhoto(
  supabase: BrowserSupabaseClient,
  reviewId: number,
  mediaId: string,
  sortOrder = 0,
): Promise<void> {
  const { error } = await supabase.from("review_photos").upsert(
    { review_id: reviewId, media_id: mediaId, sort_order: sortOrder },
    { onConflict: "review_id,media_id", ignoreDuplicates: true },
  );
  if (error) throw new Error("사진을 리뷰에 연결하지 못했어요. 리뷰와 사진 소유자를 확인해 주세요.");
}

export async function detachMenuPhoto(supabase: BrowserSupabaseClient, menuId: number): Promise<void> {
  await attachMenuPhoto(supabase, menuId, null);
}

export async function detachReviewPhoto(
  supabase: BrowserSupabaseClient,
  reviewId: number,
  mediaId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("review_photos")
    .delete()
    .eq("review_id", reviewId)
    .eq("media_id", mediaId)
    .select("media_id")
    .maybeSingle();
  if (error || !data) throw new Error("리뷰 사진 연결을 해제하지 못했어요. 권한을 확인해 주세요.");
}

/** Tombstones an unlinked asset; physical cleanup is delayed by the database. */
export async function queueDetachedMediaCleanup(
  supabase: BrowserSupabaseClient,
  mediaId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("queue_media_cleanup", { p_media_id: mediaId });
  if (error || data !== true) throw new Error("사진은 숨겼지만 정리 요청을 등록하지 못했어요. 관리자에게 문의해 주세요.");
}
