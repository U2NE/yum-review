import { NextRequest, NextResponse } from "next/server";
import { isNaverPlaceSearchConfigured, searchNaverPlaces } from "@/lib/data/location";
import { consumeLocationSearchQuota } from "@/lib/security/location-rate-limit.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const cleaned = query.trim();
  const validQuery = Boolean(cleaned) && cleaned.length <= 100;
  if (!validQuery) {
    const result = await searchNaverPlaces(query);
    return privateResponse(result, 400);
  }

  // With no Naver credentials there is no external call to protect, so keep
  // the existing helpful setup message available without a rate-limit store.
  if (!isNaverPlaceSearchConfigured()) {
    return privateResponse(await searchNaverPlaces(query), 200);
  }

  const limit = await consumeLocationSearchQuota(request.headers.get("x-real-ip"));
  if (limit.status === "unavailable") {
    return privateResponse({
      configured: true,
      success: false,
      message: "장소 검색 보호 설정을 사용할 수 없어 검색을 잠시 중단했어요.",
      results: [],
    }, 503);
  }
  if (limit.status === "limited") {
    const response = privateResponse({
      configured: true,
      success: false,
      message: "장소 검색 요청이 많아요. 잠시 후 다시 시도해 주세요.",
      results: [],
    }, 429);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  return privateResponse(await searchNaverPlaces(query), 200);
}

function privateResponse(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
