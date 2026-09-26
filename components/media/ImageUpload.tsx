"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  attachMenuPhoto,
  attachReviewPhoto,
  detachMenuPhoto,
  detachReviewPhoto,
  queueDetachedMediaCleanup,
  getMediaPreviews,
  getMenuPhotoPreview,
  getReviewPhotoPreviews,
  type MediaPreview,
} from "@/lib/data/media";
import { uploadMedia, type MediaUploadProgress } from "@/lib/media/storage";

type SharedProps = {
  initialMediaIds?: string[];
  disabled?: boolean;
  onChange?: (mediaIds: string[]) => void;
};

export type ImageUploadProps =
  | (SharedProps & { kind: "MENU"; menuId: number; reviewId?: never })
  | (SharedProps & { kind: "REVIEW"; reviewId: number; menuId?: never });

const MAX_REVIEW_PHOTOS = 5;

export function ImageUpload(props: ImageUploadProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [media, setMedia] = useState<MediaPreview[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<MediaUploadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mediaIds = media.map((item) => item.id);
  const maxFiles = props.kind === "MENU" ? 1 : MAX_REVIEW_PHOTOS;
  const canAdd = !props.disabled && !busy && (media.length < maxFiles || props.kind === "MENU");

  const reloadMedia = useCallback(async () => {
    if (props.kind === "MENU") {
      const photo = await getMenuPhotoPreview(supabase, props.menuId);
      const fallback = props.initialMediaIds?.length ? await getMediaPreviews(supabase, props.initialMediaIds) : [];
      setMedia(photo ? [photo] : fallback);
    } else {
      const photos = await getReviewPhotoPreviews(supabase, props.reviewId);
      const fallback = props.initialMediaIds?.length ? await getMediaPreviews(supabase, props.initialMediaIds) : [];
      setMedia(photos.length ? photos : fallback);
    }
  }, [props.kind, props.menuId, props.reviewId, props.initialMediaIds, supabase]);

  useEffect(() => {
    void reloadMedia();
    const refreshTimer = window.setInterval(() => void reloadMedia(), 45_000);
    return () => window.clearInterval(refreshTimer);
  }, [reloadMedia]);

  async function addFile(file: File) {
    setBusy(true);
    setProgress(null);
    setPendingFile(file);
    setMessage("");
    setIsError(false);
    try {
      const target = props.kind === "MENU"
        ? { kind: "MENU" as const, menuId: props.menuId }
        : { kind: "REVIEW" as const, reviewId: props.reviewId };
      const uploaded = await uploadMedia(supabase, file, target, setProgress);

      try {
        if (props.kind === "MENU") {
          await attachMenuPhoto(supabase, props.menuId, uploaded.mediaId);
        } else {
          await attachReviewPhoto(supabase, props.reviewId, uploaded.mediaId, media.length);
        }
      } catch (associationError) {
        try {
          await queueDetachedMediaCleanup(supabase, uploaded.mediaId);
        } catch {
          const message = associationError instanceof Error ? associationError.message : "사진 연결에 실패했어요.";
          throw new Error(`${message} 임시 사진 정리 요청도 등록하지 못했어요. 관리자에게 문의해 주세요.`);
        }
        throw associationError;
      }

      let cleanupWarning = "";
      const replacedMenuPhoto = props.kind === "MENU" ? media[0] : undefined;
      if (replacedMenuPhoto && replacedMenuPhoto.id !== uploaded.mediaId) {
        try {
          await queueDetachedMediaCleanup(supabase, replacedMenuPhoto.id);
        } catch {
          cleanupWarning = "새 사진은 저장했고 이전 사진은 화면에서 숨겼어요. 이전 사진의 정리 요청은 관리자 확인이 필요해요.";
        }
      }
      await reloadMedia();
      setPendingFile(null);
      setMessage(cleanupWarning || (
        uploaded.optimized
          ? `${formatBytes(uploaded.originalBytes)} 사진을 ${formatBytes(uploaded.storedBytes)}로 줄여 저장했어요.`
          : uploaded.storedBytes > 10_000_000
            ? "압축을 시도했지만 파일을 더 줄이지 못해 원본 크기로 저장했어요."
            : "사진을 저장했어요."
      ));
      setIsError(Boolean(cleanupWarning));
      props.onChange?.(props.kind === "MENU" ? [uploaded.mediaId] : [...mediaIds, uploaded.mediaId]);
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "사진 저장에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(item: MediaPreview) {
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      if (props.kind === "MENU") await detachMenuPhoto(supabase, props.menuId);
      else await detachReviewPhoto(supabase, props.reviewId, item.id);
      const nextIds = mediaIds.filter((id) => id !== item.id);
      setMedia((current) => current.filter((entry) => entry.id !== item.id));
      props.onChange?.(nextIds);
      try {
        await queueDetachedMediaCleanup(supabase, item.id);
        setMessage("사진을 화면에서 숨겼어요. 원본은 복구할 수 있도록 7일 동안 보관돼요.");
      } catch {
        setIsError(true);
        setMessage("사진 연결을 해제해 화면에서는 숨겼어요. 정리 요청 등록이 되지 않아 관리자 확인이 필요해요.");
      }
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "사진 연결을 해제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  function handleChoose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void addFile(file);
  }

  return (
    <section aria-label={props.kind === "MENU" ? "메뉴 사진" : "리뷰 사진"} style={{ display: "grid", gap: "0.65rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.55rem" }}>
        <strong>{props.kind === "MENU" ? "메뉴 사진" : "리뷰 사진"}</strong>
        <span style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
          JPEG · PNG · WebP · 사진당 100MB 미만{props.kind === "REVIEW" ? ` · 최대 ${MAX_REVIEW_PHOTOS}장` : ""}
        </span>
      </div>

      {media.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem" }}>
          {media.map((item) => (
            <figure key={item.id} style={{ margin: 0, display: "grid", gap: "0.35rem", width: "min(12rem, 44vw)" }}>
              <img
                src={item.url}
                alt={props.kind === "MENU" ? "등록된 메뉴 사진" : "등록된 리뷰 사진"}
                style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "0.7rem", border: "1px solid var(--line)" }}
                onError={() => void reloadMedia()}
              />
              <button
                type="button"
                onClick={() => void removePhoto(item)}
                disabled={busy || props.disabled}
                style={secondaryButton}
              >
                사진 숨기기
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, color: "var(--muted)" }}>등록된 사진이 없어요.</p>
      )}

      {canAdd ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button type="button" onClick={() => inputRef.current?.click()} style={primaryButton}>
            {props.kind === "MENU" ? (media.length ? "사진 바꾸기" : "사진 선택") : "사진 추가"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleChoose}
            aria-label="업로드할 사진 선택"
            style={{ display: "none" }}
          />
          {isError && pendingFile ? (
            <button type="button" onClick={() => void addFile(pendingFile)} style={secondaryButton}>
              다시 시도
            </button>
          ) : null}
        </div>
      ) : null}

      {busy && progress ? (
        <div aria-live="polite" style={{ display: "grid", gap: "0.25rem", maxWidth: "24rem" }}>
          <span>사진 저장 중… {progress.percent}%{progress.resumable ? " · 이어올리기 사용" : ""}</span>
          <progress value={progress.percent} max={100} aria-label="사진 업로드 진행률" style={{ width: "100%" }} />
        </div>
      ) : busy ? <p aria-live="polite" style={{ margin: 0 }}>사진을 확인하고 있어요…</p> : null}
      {message ? <p role={isError ? "alert" : "status"} style={{ margin: 0, color: isError ? "#9a2e20" : "var(--muted)" }}>{message}</p> : null}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)}KB`;
  return `${(bytes / 1_000_000).toFixed(1)}MB`;
}

const primaryButton = {
  border: "1px solid var(--accent)",
  borderRadius: "999px",
  background: "var(--accent)",
  color: "white",
  padding: "0.5rem 0.9rem",
  fontWeight: 700,
  cursor: "pointer",
} as const;

const secondaryButton = {
  border: "1px solid var(--line)",
  borderRadius: "999px",
  background: "var(--surface)",
  padding: "0.45rem 0.8rem",
  cursor: "pointer",
} as const;
