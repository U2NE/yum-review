import { NextResponse } from "next/server";
import { forwardGeocodeAddress } from "@/lib/data/vworld-geocoder.server";
import { RESTAURANT_LOCATION_CONSENT_VERSION } from "@/lib/data/location";
import { hasValidCoordinates } from "@/lib/location/distance";
import { readBoundedJson } from "@/lib/server/read-bounded-json.server";
import { consumeLocationSearchQuota } from "@/lib/security/location-rate-limit.server";
import { setRestaurantLocationServer } from "@/lib/supabase/admin.server";
import { personalWriteFreezeResponse } from "@/lib/supabase/personal-write-gate.server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function reply(body: Record<string, unknown>, status: number, headers: HeadersInit = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request, context: RouteContext) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "요청을 확인해 주세요." }, 403);
  }

  const { id } = await context.params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) {
    return reply({ error: "가게 정보를 확인할 수 없어요." }, 400);
  }

  const freezeResponse = await personalWriteFreezeResponse();
  if (freezeResponse) return freezeResponse;

  const parsed = await readBoundedJson(request, 2048);
  if (!parsed.ok) return reply({ error: "가게 주소와 동의 여부를 확인해 주세요." }, parsed.status);
  if (!parsed.value || typeof parsed.value !== "object") return reply({ error: "가게 주소와 동의 여부를 확인해 주세요." }, 400);
  const body = parsed.value as { address?: unknown; consent?: unknown };
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!address || address.length > 160) return reply({ error: "주소는 160자 이내로 입력해 주세요." }, 400);
  if (body.consent !== true) return reply({ error: "가게 위치 저장에 동의해야 등록할 수 있어요." }, 400);

  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return reply({ error: "로그인한 뒤 다시 시도해 주세요." }, 401);

    const rpc = (supabase.rpc as unknown as (
      functionName: string,
      arguments_: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code?: string } | null }>).bind(supabase);
    const { data: ownerCanEdit, error: ownerError } = await rpc("owner_can_set_restaurant_location", {
      p_restaurant_id: Number(id),
    });
    if (ownerError) {
      return reply({ error: ownerError.code === "42501" ? "이 가게의 위치를 수정할 권한이 없어요." : "가게 권한을 확인하지 못했어요." }, ownerError.code === "42501" ? 403 : 503);
    }
    if (ownerCanEdit !== true) return reply({ error: "가게 정보를 찾지 못했어요." }, 404);

    const limit = await consumeLocationSearchQuota(request.headers.get("x-real-ip"));
    if (limit.status === "unavailable") {
      return reply({ error: "위치 변환 보호 설정을 사용할 수 없어요." }, 503);
    }
    if (limit.status === "limited") {
      return reply(
        { error: "위치 변환 요청이 많아요. 잠시 후 다시 시도해 주세요." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    const geocoded = await forwardGeocodeAddress(address);
    const place = geocoded.results[0];
    if (!geocoded.success || !place
        || typeof place.latitude !== "number"
        || typeof place.longitude !== "number"
        || !hasValidCoordinates(place.latitude, place.longitude)) {
      return reply({ error: geocoded.message ?? "주소의 위치를 찾지 못했어요. 주소를 확인해 주세요." }, 422);
    }

    const { data, error } = await setRestaurantLocationServer({
      restaurantId: Number(id),
      ownerId: authData.user.id,
      address,
      latitude: place.latitude,
      longitude: place.longitude,
      consentVersion: RESTAURANT_LOCATION_CONSENT_VERSION,
    });
    if (error) {
      return reply({ error: error.code === "42501" ? "이 가게의 위치를 수정할 권한이 없어요." : "가게 위치를 저장하지 못했어요." }, error.code === "42501" ? 403 : 503);
    }
    if (data !== true) return reply({ error: "가게 정보를 찾지 못했어요." }, 404);
    return reply({ success: true, message: "가게 주소와 위치를 저장했어요." }, 200);
  } catch {
    return reply({ error: "가게 위치를 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}
