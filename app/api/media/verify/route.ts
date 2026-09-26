import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { readBoundedJson } from "@/lib/server/read-bounded-json.server";
import {
  assertMediaVerificationConfigured,
  createMediaKeyPreflight,
  createMediaVerificationProof,
} from "@/lib/media/verify-proof";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimMediaVerificationSlot, releaseMediaVerificationSlot } from "@/lib/supabase/admin.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 99_999_999;
const MAX_PIXELS = 40_000_000;
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PRE_IDAT_CHUNKS = 4096;

function response(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function inspectPngAnimationChunks(bytes: Buffer): boolean | "too-many-chunks" {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;

  let offset = PNG_SIGNATURE.length;
  for (let index = 0; index < MAX_PRE_IDAT_CHUNKS; index += 1) {
    if (bytes.length - offset < 12) return false;
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(chunkType)) return false;
    if (chunkLength > bytes.length - offset - 12) return false;

    // APNG declares animation control in a framed chunk before the first IDAT.
    if (chunkType === "acTL") return true;
    if (chunkType === "IDAT" || chunkType === "IEND") return false;
    offset += chunkLength + 12;
  }

  // Do not accept a PNG whose pre-IDAT chunk framing exceeds the parser's work bound.
  return "too-many-chunks";
}

function retryResponse(seconds: number) {
  return NextResponse.json(
    { error: "사진 검증 요청이 많습니다. 잠시 후 다시 시도해 주세요." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(seconds) } },
  );
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return response("요청을 확인해 주세요.", 403);
  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return response("요청 형식이 올바르지 않습니다.", parsed.status);
  const body = parsed.value;
  if (!body || typeof body !== "object" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String((body as { mediaId?: unknown }).mediaId ?? ""))) {
    return response("사진 업로드 정보를 확인해 주세요.", 400);
  }
  const mediaId = String((body as { mediaId: string }).mediaId).toLowerCase();

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  let leaseToken: string | null = null;
  try {
    supabase = await createSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
    const user = userResult.user;
    const token = sessionResult.session?.access_token;
    if (userError || sessionError || !user || !token || sessionResult.session?.user.id !== user.id) {
      return response("로그인한 뒤 다시 시도해 주세요.", 401);
    }

    try {
      assertMediaVerificationConfigured();
    } catch {
      return response("사진 검증 설정을 확인할 수 없습니다.", 503);
    }

    const { data: intents, error: intentError } = await supabase.rpc("get_media_verification_intent", {
      p_media_id: mediaId,
    });
    if (intentError || !Array.isArray(intents) || intents.length !== 1) {
      return response("대기 중인 사진을 찾을 수 없습니다.", 404);
    }
    const asset = intents[0] as unknown;
    if (!asset || typeof asset !== "object") return response("대기 중인 사진을 찾을 수 없습니다.", 404);
    const intent = asset as {
      id?: unknown;
      object_path?: unknown;
      content_type?: unknown;
      original_bytes?: unknown;
      stored_bytes?: unknown;
    };
    if (intent.id !== mediaId || typeof intent.object_path !== "string" || !intent.object_path
        || typeof intent.content_type !== "string" || !intent.content_type
        || !["number", "string"].includes(typeof intent.original_bytes)
        || !["number", "string"].includes(typeof intent.stored_bytes)) {
      return response("대기 중인 사진을 찾을 수 없습니다.", 404);
    }
    const verifiedAsset = {
      id: intent.id as string,
      object_path: intent.object_path as string,
      content_type: intent.content_type as string,
      original_bytes: intent.original_bytes as string | number,
      stored_bytes: intent.stored_bytes as string | number,
    };
    const originalBytes = Number(verifiedAsset.original_bytes);
    const declaredStoredBytes = Number(verifiedAsset.stored_bytes);
    if (!Number.isSafeInteger(originalBytes) || originalBytes < 1 || originalBytes >= 100_000_000
        || !Number.isSafeInteger(declaredStoredBytes) || declaredStoredBytes < 1 || declaredStoredBytes >= 100_000_000) {
      return response("사진 크기 정보를 확인할 수 없습니다.", 422);
    }

    // Charge this authorized PENDING verification attempt before any Storage
    // probe. The quota RPC returns no slot token and cannot reserve capacity.
    const { data: attempts, error: attemptError } = await supabase.rpc("consume_media_verification_attempt", {
      p_media_id: mediaId,
    });
    if (attemptError) return response("사진 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    if (!Array.isArray(attempts) || attempts.length !== 1) return response("대기 중인 사진을 찾을 수 없습니다.", 404);
    const attempt = attempts[0] as { allowed?: unknown; retry_after_seconds?: unknown } | null;
    if (!attempt || typeof attempt !== "object" || typeof attempt.allowed !== "boolean") {
      return response("사진 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
    if (!attempt.allowed) {
      const retryAfter = Number(attempt.retry_after_seconds);
      if (!Number.isSafeInteger(retryAfter) || retryAfter < 1 || retryAfter > 60) {
        return response("사진 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
      }
      return retryResponse(retryAfter);
    }

    // Use the caller's Storage JWT to check the exact object without fetching
    // its body. Missing objects consume an attempt but never reserve a decoder slot.
    const { data: objectExists, error: existenceError } = await supabase.storage
      .from("yum-review-media")
      .exists(verifiedAsset.object_path);
    if (existenceError || !objectExists) {
      return response("사진 파일 크기 또는 접근 권한을 확인해 주세요.", 422);
    }

    // The service-only slot RPC independently rechecks owner/PENDING and target
    // authorization before reserving one of the two global decode slots.
    const { data: claims, error: claimError } = await claimMediaVerificationSlot(mediaId, user.id);
    if (claimError) return response("사진 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    if (!Array.isArray(claims) || claims.length !== 1) return response("대기 중인 사진을 찾을 수 없습니다.", 404);
    const claim = claims[0] as { allowed?: unknown; lease_token?: unknown; retry_after_seconds?: unknown } | null;
    if (!claim || typeof claim !== "object" || typeof claim.allowed !== "boolean") {
      return response("사진 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    }
    if (!claim.allowed) {
      const retryAfter = Number(claim.retry_after_seconds);
      if (!Number.isSafeInteger(retryAfter) || retryAfter < 1 || retryAfter > 90) {
        return response("사진 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
      }
      return retryResponse(retryAfter);
    }
    if (typeof claim.lease_token === "string") leaseToken = claim.lease_token;

    try {
      if (!leaseToken || !/^[0-9a-f]{64}$/.test(leaseToken)) {
        return response("사진 검증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
      }

      // PENDING intent and local configuration are established before this Vault parity check.
      const preflight = createMediaKeyPreflight(mediaId);
      const { data: keyMatches, error: keyPreflightError } = await supabase.rpc("verify_media_validation_key", {
        p_media_id: mediaId,
        p_key_id: preflight.keyId,
        p_challenge: preflight.challenge,
        p_signature: preflight.signature,
      });
      if (keyPreflightError || keyMatches !== true) {
        return response("사진 검증 설정을 확인할 수 없습니다.", 503);
      }

      // Storage reads use only the caller's JWT and publishable key; never bypass RLS.
      const { data: object, error: downloadError } = await supabase.storage.from("yum-review-media").download(verifiedAsset.object_path);
      if (downloadError || !object || object.size < 1 || object.size > MAX_BYTES) {
        return response("사진 파일 크기 또는 접근 권한을 확인해 주세요.", 422);
      }
      const bytes = Buffer.from(await object.arrayBuffer());
      if (bytes.length !== object.size || bytes.length !== declaredStoredBytes || bytes.length > MAX_BYTES) {
        return response("사진 파일을 확인할 수 없습니다.", 422);
      }

      const pngAnimation = inspectPngAnimationChunks(bytes);
      if (pngAnimation === true) {
        return response("움직이는 사진이나 여러 페이지가 포함된 파일은 업로드할 수 없습니다.", 422);
      }
      if (pngAnimation === "too-many-chunks") {
        return response("PNG 파일 구성이 허용 범위를 초과했습니다.", 422);
      }
      const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, sequentialRead: true, failOn: "warning", animated: true });
      const metadata = await image.metadata();
      const contentType = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "";
      if (!contentType || !supportedTypes.has(contentType) || contentType !== verifiedAsset.content_type) {
        return response("파일 형식과 실제 사진 형식이 다릅니다.", 422);
      }
      // Sharp reports pages for animated WebP and other multi-page formats.
      if (metadata.pages !== undefined && metadata.pages > 1) {
        return response("움직이는 사진이나 여러 페이지가 포함된 파일은 업로드할 수 없습니다.", 422);
      }
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
        return response("사진 해상도가 허용 범위를 넘었습니다.", 422);
      }
      // stats() runs the decoder across the image; header-only MIME and dimensions are insufficient.
      await image.stats();

      const proof = createMediaVerificationProof({
        mediaId: verifiedAsset.id,
        objectPath: verifiedAsset.object_path,
        contentType,
        originalBytes,
        storedBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      const { data: activated, error: activationError } = await supabase.rpc("activate_media_upload", {
        p_media_id: verifiedAsset.id,
        p_proof_payload: proof.payload,
        p_proof_signature: proof.signature,
      });
      if (activationError || activated !== true) return response("사진 검증을 완료하지 못했습니다. 다시 시도해 주세요.", 422);
      return NextResponse.json({ activated: true }, { headers: { "Cache-Control": "no-store" } });
    } finally {
      // If the request is cancelled or any branch returns, attempt release. A 90-second
      // database expiry is the backstop if the process or network cannot complete it.
      if (leaseToken) {
        try {
          await releaseMediaVerificationSlot(mediaId, user.id, leaseToken);
        } catch {
          // Expiring the lease remains fail-safe when a best-effort release cannot run.
        }
      }
    }
  } catch {
    // Vault errors, decoder failures, and all unexpected failures remain closed.
    return response("사진 검증을 완료하지 못했습니다. 설정과 파일을 확인해 주세요.", 503);
  }
}
