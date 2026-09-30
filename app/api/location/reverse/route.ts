import { NextResponse } from "next/server";
import { reverseGeocodeCoordinates, isVWorldGeocoderConfigured } from "@/lib/data/vworld-geocoder.server";
import { loadRestaurantIdsWithinRadius } from "@/lib/data/catalog";
import { hasValidCoordinates } from "@/lib/location/distance";
import { consumeLocationSearchQuota } from "@/lib/security/location-rate-limit.server";
import { readBoundedJson } from "@/lib/server/read-bounded-json.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function privateResponse(body: unknown, status: number, headers: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", ...headers },
  });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return privateResponse({ configured: isVWorldGeocoderConfigured(), success: false, message: "요청을 확인해 주세요.", address: null, distanceSuccess: false, restaurantIds: null }, 403);
  }

  const parsed = await readBoundedJson(request, 512);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    return privateResponse({ configured: isVWorldGeocoderConfigured(), success: false, message: "위치 좌표를 확인해 주세요.", address: null, distanceSuccess: false, restaurantIds: null }, parsed.ok ? 400 : parsed.status);
  }
  const value = parsed.value as { latitude?: unknown; longitude?: unknown; includeAddress?: unknown; radiusMeters?: unknown };
  const latitude = value.latitude;
  const longitude = value.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !hasValidCoordinates(latitude, longitude)) {
    return privateResponse({ configured: isVWorldGeocoderConfigured(), success: false, message: "위치 좌표를 확인해 주세요.", address: null, distanceSuccess: false, restaurantIds: null }, 400);
  }

  const includeAddress = value.includeAddress === undefined ? true : value.includeAddress;
  const radiusMeters = value.radiusMeters === undefined || value.radiusMeters === null ? null : value.radiusMeters;
  if (typeof includeAddress !== "boolean"
      || (radiusMeters !== null && (typeof radiusMeters !== "number" || ![300, 500, 1000].includes(radiusMeters)))
      || (includeAddress === false && radiusMeters === null)) {
    return privateResponse({ configured: isVWorldGeocoderConfigured(), success: false, message: "거리 검색 조건을 확인해 주세요.", address: null, distanceSuccess: false, restaurantIds: null }, 400);
  }

  const limit = await consumeLocationSearchQuota(request.headers.get("x-real-ip"));
  if (limit.status === "unavailable") {
    return privateResponse({ configured: isVWorldGeocoderConfigured(), success: false, message: "위치 검색 보호 설정을 사용할 수 없어요.", address: null, distanceSuccess: false, restaurantIds: null }, 503);
  }
  if (limit.status === "limited") {
    return privateResponse(
      { configured: isVWorldGeocoderConfigured(), success: false, message: "위치 검색 요청이 많아요. 잠시 후 다시 시도해 주세요.", address: null, distanceSuccess: false, restaurantIds: null },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  const configured = isVWorldGeocoderConfigured();
  const addressResult = includeAddress
    ? configured
      ? await reverseGeocodeCoordinates(latitude, longitude)
      : { configured: false, success: false, message: "주소 변환 서비스를 사용할 수 없어요.", address: null }
    : null;

  let restaurantIds: string[] | null = null;
  let distanceSuccess = true;
  let distanceMessage: string | null = null;
  if (typeof radiusMeters === "number") {
    try {
      const supabase = await createSupabaseServerClient();
      restaurantIds = await loadRestaurantIdsWithinRadius(supabase, { latitude, longitude }, radiusMeters);
    } catch {
      distanceSuccess = false;
      distanceMessage = "거리 검색 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
    }
  }

  const success = addressResult?.success ?? distanceSuccess;
  const message = addressResult?.message ?? distanceMessage;
  const status = typeof radiusMeters === "number"
    ? distanceSuccess ? 200 : 503
    : addressResult?.success ? 200 : configured ? 502 : 503;
  return privateResponse({
    configured,
    success,
    message,
    address: addressResult?.address ?? null,
    distanceApplied: typeof radiusMeters === "number",
    distanceSuccess,
    distanceMessage,
    restaurantIds,
  }, status);
}
