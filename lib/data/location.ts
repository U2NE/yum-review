import "server-only";

export const DANKOOK_JUKJEON = {
  label: "단국대 죽전캠퍼스",
  latitude: 37.3218,
  longitude: 127.1268,
} as const;

export const DISTANCE_OPTIONS = ["all", "300", "500", "1000"] as const;
export type DistanceOption = (typeof DISTANCE_OPTIONS)[number];

export type PlaceSuggestion = {
  name: string;
  category: string;
  address: string;
  roadAddress: string;
  sourceUrl: string;
  latitude: number | null;
  longitude: number | null;
};

export type PlaceSearchResult = {
  configured: boolean;
  success: boolean;
  message: string | null;
  results: PlaceSuggestion[];
};

function stripMarkup(value: unknown) {
  return String(value ?? "")
    .replace(/<\/?b>/gi, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseCoordinate(value: unknown, maximum: number) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const coordinate = Number(value) / 10_000_000;
  return Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= maximum
    ? coordinate
    : null;
}

export function isNaverPlaceSearchConfigured() {
  return Boolean(
    process.env.NAVER_LOCAL_CLIENT_ID?.trim()
    && process.env.NAVER_LOCAL_CLIENT_SECRET?.trim(),
  );
}

/** Server-only, ephemeral Naver Local Search adapter. Results are never cached or stored. */
export async function searchNaverPlaces(rawQuery: string): Promise<PlaceSearchResult> {
  const query = rawQuery.trim();
  if (!query || query.length > 100) {
    return {
      configured: true,
      success: false,
      message: query ? "장소 검색어는 100자 이하여야 해요." : "장소 이름이나 주소를 입력해 주세요.",
      results: [],
    };
  }

  const clientId = process.env.NAVER_LOCAL_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVER_LOCAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return {
      configured: false,
      success: false,
      message: "장소 검색을 사용하려면 서버에 NAVER_LOCAL_CLIENT_ID와 NAVER_LOCAL_CLIENT_SECRET을 설정해 주세요.",
      results: [],
    };
  }

  const url = new URL("https://openapi.naver.com/v1/search/local.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", "5");
  url.searchParams.set("sort", "random");

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6_500),
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        configured: true,
        success: false,
        message: "장소 검색 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        results: [],
      };
    }

    const payload = (await response.json()) as { items?: unknown };
    const sourceItems = Array.isArray(payload.items) ? payload.items.slice(0, 5) : [];
    const results = sourceItems.map((rawItem) => {
      const item = rawItem && typeof rawItem === "object"
        ? (rawItem as Record<string, unknown>)
        : {};
      let latitude = parseCoordinate(item.mapy, 90);
      let longitude = parseCoordinate(item.mapx, 180);
      if ((latitude === null) !== (longitude === null)) {
        latitude = null;
        longitude = null;
      }

      return {
        name: stripMarkup(item.title),
        category: stripMarkup(item.category),
        address: stripMarkup(item.address),
        roadAddress: stripMarkup(item.roadAddress),
        sourceUrl: typeof item.link === "string" ? item.link : "",
        latitude,
        longitude,
      };
    });

    return {
      configured: true,
      success: true,
      message: results.length ? null : "검색 결과가 없어요.",
      results,
    };
  } catch {
    return {
      configured: true,
      success: false,
      message: "장소 검색 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      results: [],
    };
  }
}
