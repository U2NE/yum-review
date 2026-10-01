import "server-only";

import { hasValidCoordinates } from "@/lib/location/distance";

const ENDPOINT = "https://api.vworld.kr/req/address";
const REQUEST_TIMEOUT_MS = 6_500;
const MAX_ADDRESS_LENGTH = 160;
const VWorldFailureCategory = ["transport", "http", "invalid_json", "provider_response"] as const;
type VWorldFailureCategory = typeof VWorldFailureCategory[number];

class VWorldRequestError extends Error {
  constructor(readonly category: VWorldFailureCategory, readonly status?: number) {
    super("VWorld request failed");
  }
}

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

export type ReverseGeocodeResult = {
  configured: boolean;
  success: boolean;
  message: string | null;
  address: string | null;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function configuredKey() {
  const key = process.env.VWORLD_API_KEY?.trim();
  return key ? key : null;
}

function responseResults(payload: unknown): JsonRecord[] {
  const root = record(payload);
  const response = record(root?.response);
  if (!response || response.status !== "OK") throw new Error("VWorld provider response unavailable");
  const result = response.result;
  if (Array.isArray(result)) {
    const rows: JsonRecord[] = [];
    for (const item of result) {
      const row = record(item);
      if (!row) throw new Error("Malformed VWorld provider response");
      rows.push(row);
    }
    return rows;
  }
  const single = record(result);
  if (single) return [single];
  throw new Error("Malformed VWorld provider response");
}

function coordinate(value: unknown, maximum: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -maximum && parsed <= maximum ? parsed : null;
}

function pointFromResults(results: JsonRecord[]): { latitude: number; longitude: number } | null {
  for (const result of results) {
    const point = record(result.point);
    if (!point) continue;
    const latitude = coordinate(point.y, 90);
    const longitude = coordinate(point.x, 180);
    if (latitude !== null && longitude !== null) return { latitude, longitude };
  }
  return null;
}

export function parseVWorldPoint(payload: unknown): { latitude: number; longitude: number } | null {
  try {
    return pointFromResults(responseResults(payload));
  } catch {
    return null;
  }
}

function cleanAddress(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

function vworldMessage() {
  return "주소 변환을 완료하지 못했어요. 주소를 확인한 뒤 다시 시도해 주세요.";
}

function canonicalReferer(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password
      || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    return `${url.origin}/`;
  } catch {
    return null;
  }
}

function logProviderFailure(error: unknown) {
  const category = error instanceof VWorldRequestError ? error.category : "provider_response";
  const status = error instanceof VWorldRequestError && Number.isInteger(error.status)
    ? error.status
    : undefined;
  console.warn("VWorld geocoder request failed", status === undefined ? { category } : { category, status });
}

async function requestVWorld(parameters: Record<string, string>, key: string): Promise<unknown> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("service", "address");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("format", "json");
  url.searchParams.set("crs", "epsg:4326");
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);

  const referer = canonicalReferer();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json", ...(referer ? { Referer: referer } : {}) },
    });
  } catch {
    throw new VWorldRequestError("transport");
  }
  if (!response.ok) throw new VWorldRequestError("http", response.status);
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new VWorldRequestError(error instanceof SyntaxError ? "invalid_json" : "transport", response.status);
  }
}

export function isVWorldGeocoderConfigured() {
  return configuredKey() !== null;
}

export async function forwardGeocodeAddress(rawAddress: string): Promise<PlaceSearchResult> {
  const address = rawAddress.trim();
  if (!address || address.length > MAX_ADDRESS_LENGTH) {
    return {
      configured: isVWorldGeocoderConfigured(),
      success: false,
      message: address ? "주소는 160자 이내로 입력해 주세요." : "주소를 입력해 주세요.",
      results: [],
    };
  }

  const key = configuredKey();
  if (!key) {
    return { configured: false, success: false, message: "주소 변환 서비스를 사용할 수 없어요.", results: [] };
  }

  try {
    let payload = await requestVWorld({ request: "getCoord", type: "ROAD", address }, key);
    let point = pointFromResults(responseResults(payload));
    if (!point) {
      payload = await requestVWorld({ request: "getCoord", type: "PARCEL", address }, key);
      point = pointFromResults(responseResults(payload));
    }
    if (!point || !hasValidCoordinates(point.latitude, point.longitude)) {
      return { configured: true, success: false, message: "해당 주소의 위치를 찾지 못했어요.", results: [] };
    }

    const result: PlaceSuggestion = {
      name: address,
      category: "",
      address,
      roadAddress: address,
      sourceUrl: "",
      ...point,
    };
    return { configured: true, success: true, message: null, results: [result] };
  } catch (error) {
    logProviderFailure(error);
    return { configured: true, success: false, message: vworldMessage(), results: [] };
  }
}

export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult> {
  if (!hasValidCoordinates(latitude, longitude)) {
    return { configured: isVWorldGeocoderConfigured(), success: false, message: "위치 좌표를 확인해 주세요.", address: null };
  }
  const key = configuredKey();
  if (!key) return { configured: false, success: false, message: "주소 변환 서비스를 사용할 수 없어요.", address: null };

  try {
    const payload = await requestVWorld({
      request: "getAddress",
      type: "both",
      point: `${longitude},${latitude}`,
    }, key);
    const results = responseResults(payload);
    const selected = results.find((item) => String(item.type ?? "").toLowerCase() === "road")
      ?? results.find((item) => cleanAddress(item.text))
      ?? null;
    const address = cleanAddress(selected?.text);
    if (!address) return { configured: true, success: false, message: "현재 위치의 주소를 찾지 못했어요.", address: null };
    return { configured: true, success: true, message: null, address };
  } catch (error) {
    logProviderFailure(error);
    return { configured: true, success: false, message: vworldMessage(), address: null };
  }
}
