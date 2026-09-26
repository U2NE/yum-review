import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  TUS_UPLOAD_THRESHOLD,
  validateAndOptimizeImage,
  type SupportedImageType,
} from "@/lib/media/validate-image";

const BUCKET = "yum-review-media";
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
type BrowserSupabaseClient = ReturnType<typeof createSupabaseBrowserClient>;

export type UploadTarget =
  | { kind: "MENU"; menuId: number }
  | { kind: "REVIEW"; reviewId: number };

export type MediaUploadProgress = {
  sentBytes: number;
  totalBytes: number;
  percent: number;
  resumable: boolean;
};

export type MediaUploadResult = {
  mediaId: string;
  objectPath: string;
  contentType: SupportedImageType;
  originalBytes: number;
  storedBytes: number;
  optimized: boolean;
};

function publicSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("사진 업로드 설정이 아직 준비되지 않았어요.");
  return value.replace(/\/$/, "");
}

function publicKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) throw new Error("사진 업로드 설정이 아직 준비되지 않았어요.");
  return value;
}

function tusEndpoint(): string {
  let parsed: URL;
  try {
    parsed = new URL(publicSupabaseUrl());
  } catch {
    throw new Error("사진 업로드 설정이 올바르지 않아요.");
  }
  const isLoopback = parsed.hostname === "localhost"
    || parsed.hostname === "[::1]"
    || parsed.hostname === "::1"
    || /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(parsed.hostname);
  if (parsed.username || parsed.password || parsed.search || parsed.hash
      || (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:" && isLoopback))) {
    throw new Error("사진 업로드 설정이 안전하지 않아요.");
  }
  if (parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co") && !parsed.hostname.endsWith(".storage.supabase.co")) {
    const projectRef = parsed.hostname.slice(0, -".supabase.co".length);
    parsed.hostname = `${projectRef}.storage.supabase.co`;
  }
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/storage/v1/upload/resumable`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function validateTusLocation(locationHeader: string, endpoint: string): string {
  let expected: URL;
  let location: URL;
  try {
    expected = new URL(endpoint);
    const uploadBase = new URL(expected.toString());
    uploadBase.pathname = `${uploadBase.pathname.replace(/\/$/, "")}/`;
    location = new URL(locationHeader, uploadBase);
  } catch {
    throw new Error("큰 사진 업로드 주소를 확인하지 못했어요.");
  }

  const uploadPathPrefix = `${expected.pathname.replace(/\/$/, "")}/`;
  const sessionId = location.pathname.startsWith(uploadPathPrefix)
    ? location.pathname.slice(uploadPathPrefix.length)
    : "";
  if (location.origin !== expected.origin
      || location.username || location.password || location.search || location.hash
      || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new Error("허용되지 않은 큰 사진 업로드 주소예요.");
  }
  return location.toString();
}

function encodeMetadata(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function tusHeaders(accessToken: string): Record<string, string> {
  return {
    apikey: publicKey(),
    authorization: `Bearer ${accessToken}`,
    "Tus-Resumable": "1.0.0",
  };
}

async function readOffset(location: string, accessToken: string, expectedSize: number): Promise<number> {
  const response = await fetch(location, {
    method: "HEAD",
    headers: tusHeaders(accessToken),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("큰 사진 업로드 연결이 끊겼어요.");
  const offset = Number(response.headers.get("Upload-Offset"));
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > expectedSize) {
    throw new Error("큰 사진 업로드 상태를 확인하지 못했어요.");
  }
  return offset;
}

async function uploadTus(
  client: BrowserSupabaseClient,
  path: string,
  file: File,
  onProgress?: (progress: MediaUploadProgress) => void,
): Promise<void> {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) throw new Error("로그인 상태를 확인한 뒤 다시 시도해 주세요.");

  const endpoint = tusEndpoint();
  const metadata = [
    ["bucketName", BUCKET],
    ["objectName", path],
    ["contentType", file.type],
    ["cacheControl", "3600"],
    ["metadata", JSON.stringify({ source: "yum-review-browser" })],
  ].map(([key, value]) => `${key} ${encodeMetadata(value)}`).join(",");

  let created: Response;
  try {
    created = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...tusHeaders(accessToken),
        "Upload-Length": String(file.size),
        "Upload-Metadata": metadata,
        "x-upsert": "false",
      },
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new Error("큰 사진 업로드를 시작하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
  }
  if (created.status !== 201) throw new Error("큰 사진 업로드를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
  const locationHeader = created.headers.get("Location");
  if (!locationHeader) throw new Error("큰 사진 업로드 주소를 받지 못했어요.");
  const location = validateTusLocation(locationHeader, endpoint);

  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(file.size, offset + TUS_CHUNK_BYTES);
    let sent = false;
    for (let attempt = 0; attempt < 5 && !sent; attempt += 1) {
      try {
        const response = await fetch(location, {
          method: "PATCH",
          headers: {
            ...tusHeaders(accessToken),
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": String(offset),
          },
          body: file.slice(offset, end),
          cache: "no-store",
          redirect: "error",
        });
        if (response.ok) {
          const nextOffset = Number(response.headers.get("Upload-Offset"));
          offset = Number.isSafeInteger(nextOffset) && nextOffset > offset ? nextOffset : end;
          sent = true;
        } else if (response.status === 409 || response.status >= 500 || response.status === 429) {
          offset = await readOffset(location, accessToken, file.size);
          sent = offset >= end;
        } else {
          throw new Error("큰 사진을 저장하지 못했어요. 업로드를 다시 시도해 주세요.");
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("큰 사진을 저장하지 못했어요")) throw error;
        if (attempt === 4) throw new Error("큰 사진 업로드 연결이 불안정해요. 파일을 다시 선택해 주세요.");
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        try {
          offset = await readOffset(location, accessToken, file.size);
          sent = offset >= end;
        } catch {
          // Retry the same resumable session; no bytes are sent to the app server.
        }
      }
    }
    if (!sent && offset < end) throw new Error("큰 사진 업로드를 이어가지 못했어요. 다시 시도해 주세요.");
    onProgress?.({
      sentBytes: offset,
      totalBytes: file.size,
      percent: Math.min(100, Math.round((offset / file.size) * 100)),
      resumable: true,
    });
  }
}

/** Uploads bytes from the browser directly to Supabase Storage. */
export async function uploadMedia(
  supabase: BrowserSupabaseClient,
  sourceFile: File,
  target: UploadTarget,
  onProgress?: (progress: MediaUploadProgress) => void,
): Promise<MediaUploadResult> {
  const prepared = await validateAndOptimizeImage(sourceFile);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("사진을 올리려면 먼저 로그인해 주세요.");

  const { data: intent, error: intentError } = await supabase.rpc("create_media_upload_intent", {
    p_media_kind: target.kind,
    p_menu_id: target.kind === "MENU" ? target.menuId : null,
    p_review_id: target.kind === "REVIEW" ? target.reviewId : null,
    p_content_type: prepared.contentType,
    p_original_bytes: prepared.originalBytes,
    p_stored_bytes: prepared.storedBytes,
  });
  if (intentError) throw new Error("이 사진을 올릴 권한이 없어요. 메뉴·리뷰와 로그인 상태를 확인해 주세요.");

  const row = (Array.isArray(intent) ? intent[0] : intent) as { media_id?: string; object_path?: string } | null;
  if (!row?.media_id || !row.object_path) throw new Error("사진 업로드 준비를 완료하지 못했어요.");

  try {
    if (prepared.file.size > TUS_UPLOAD_THRESHOLD) {
      await uploadTus(supabase, row.object_path, prepared.file, onProgress);
    } else {
      const { error } = await supabase.storage.from(BUCKET).upload(row.object_path, prepared.file, {
        contentType: prepared.contentType,
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw new Error("사진 저장에 실패했어요. 연결을 확인하고 다시 시도해 주세요.");
      onProgress?.({ sentBytes: prepared.file.size, totalBytes: prepared.file.size, percent: 100, resumable: false });
    }

    const activation = await fetch("/api/media/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: row.media_id }),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!activation.ok) throw new Error("사진은 전송됐지만 실제 파일 검증을 완료하지 못했어요. 다시 시도해 주세요.");
  } catch (error) {
    // Tombstoning is safe even if the transfer failed halfway; physical removal
    // remains delayed and retryable under the local Storage delete policy.
    const { data: queued, error: cleanupError } = await supabase.rpc("queue_media_cleanup", { p_media_id: row.media_id });
    if (cleanupError || queued !== true) {
      const message = error instanceof Error ? error.message : "사진 업로드에 실패했어요.";
      throw new Error(`${message} 임시 사진 정리 요청도 등록하지 못했어요. 관리자에게 문의해 주세요.`);
    }
    throw error;
  }

  return {
    mediaId: row.media_id,
    objectPath: row.object_path,
    contentType: prepared.contentType,
    originalBytes: prepared.originalBytes,
    storedBytes: prepared.storedBytes,
    optimized: prepared.optimized,
  };
}
