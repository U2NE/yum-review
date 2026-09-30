import { NextRequest, NextResponse } from "next/server";
import { forwardGeocodeAddress, isVWorldGeocoderConfigured } from "@/lib/data/vworld-geocoder.server";
import { consumeLocationSearchQuota } from "@/lib/security/location-rate-limit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function privateResponse(body: unknown, status: number, headers: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", ...headers },
  });
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!address || address.length > 160) {
    return privateResponse({
      configured: isVWorldGeocoderConfigured(),
      success: false,
      message: address ? "주소는 160자 이내로 입력해 주세요." : "주소를 입력해 주세요.",
      results: [],
    }, 400);
  }
  if (!isVWorldGeocoderConfigured()) {
    return privateResponse({ configured: false, success: false, message: "주소 변환 서비스를 사용할 수 없어요.", results: [] }, 503);
  }

  const limit = await consumeLocationSearchQuota(request.headers.get("x-real-ip"));
  if (limit.status === "unavailable") {
    return privateResponse({ configured: true, success: false, message: "주소 검색 보호 설정을 사용할 수 없어요.", results: [] }, 503);
  }
  if (limit.status === "limited") {
    return privateResponse(
      { configured: true, success: false, message: "주소 검색 요청이 많아요. 잠시 후 다시 시도해 주세요.", results: [] },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  return privateResponse(await forwardGeocodeAddress(address), 200);
}
