import "server-only";

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { DANKOOK_JUKJEON, DISTANCE_OPTIONS, type DistanceOption } from "@/lib/data/location";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const CUISINE_CATEGORIES = [
  { value: "KOREAN", label: "한식" },
  { value: "WESTERN", label: "양식" },
  { value: "CHINESE", label: "중식" },
  { value: "JAPANESE", label: "일식" },
  { value: "SNACK", label: "분식" },
  { value: "PUB", label: "주점" },
  { value: "CAFE", label: "카페·디저트" },
  { value: "OTHER", label: "기타" },
] as const;

export const SORT_OPTIONS = ["overall", "taste", "value", "portion", "reviewCount"] as const;
export type CatalogSort = (typeof SORT_OPTIONS)[number];

export type CatalogFilters = {
  q: string;
  category: string;
  region: string;
  radius: DistanceOption;
  latitude: number;
  longitude: number;
  place: string;
  sort: CatalogSort;
  mineReviews: boolean;
  wishlistedOnly: boolean;
};

export type RestaurantSummary = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type MenuCatalogItem = {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  priceKrw: number | null;
  cuisineCategory: string;
  active: boolean;
  score: number | null;
  tasteScore: number | null;
  valueScore: number | null;
  portionScore: number | null;
  reviewCount: number;
  imageUrl: string | null;
  isWishlisted: boolean;
  hasReviewed: boolean;
  restaurant: RestaurantSummary;
};

export type DiscoveryResult = {
  items: MenuCatalogItem[];
  regions: string[];
  totalMenus: number;
  excludedWithoutCoordinates: number;
};

type MenuRow = {
  id: number | string;
  restaurant_id: number | string;
  name: string;
  description: string | null;
  price_krw: number | null;
  cuisine_category: string;
  active: boolean;
  photo_media_id: string | null;
};

type RestaurantRow = {
  id: number | string;
  name: string;
  description: string | null;
  address: string | null;
  region: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

type SummaryRow = {
  menu_id: number | string;
  review_count: number | string;
  overall_avg: number | string | null;
  taste_avg: number | string | null;
  value_avg: number | string | null;
  portion_avg: number | string | null;
};

type MediaRow = { id: string; object_path: string };

const PAGE_SIZE = 500;
const SUMMARY_BATCH_SIZE = 100;
const SIGNED_READ_TTL_SECONDS = 60 * 60;

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function safeId(value: number | string) {
  const text = String(value);
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? text : "";
}

export function isCuisineCategory(value: string): boolean {
  return CUISINE_CATEGORIES.some((category) => category.value === value);
}

export function parseCatalogFilters(params: Record<string, string | string[] | undefined>): CatalogFilters {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
  const latitude = numeric(first(params.lat));
  const longitude = numeric(first(params.lon));
  const hasValidCoordinates = latitude !== null
    && longitude !== null
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
  const radiusValue = first(params.radius);
  const sortValue = first(params.sort);
  const categoryValue = first(params.category);

  return {
    q: first(params.q).trim().slice(0, 120),
    category: isCuisineCategory(categoryValue) ? categoryValue : "",
    region: first(params.region).trim().slice(0, 120),
    radius: DISTANCE_OPTIONS.includes(radiusValue as DistanceOption) ? radiusValue as DistanceOption : "all",
    latitude: hasValidCoordinates ? latitude : DANKOOK_JUKJEON.latitude,
    longitude: hasValidCoordinates ? longitude : DANKOOK_JUKJEON.longitude,
    place: hasValidCoordinates ? first(params.place).trim().slice(0, 80) || DANKOOK_JUKJEON.label : DANKOOK_JUKJEON.label,
    sort: SORT_OPTIONS.includes(sortValue as CatalogSort) ? sortValue as CatalogSort : "overall",
    mineReviews: first(params.mineReviews) === "1",
    wishlistedOnly: first(params.wishlistedOnly) === "1",
  };
}

async function fetchMenus(
  supabase: SupabaseServerClient,
  options: { restaurantId?: string; includeInactive?: boolean; menuId?: string } = {},
) {
  const rows: MenuRow[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = supabase
      .from("menus")
      .select("id, restaurant_id, name, description, price_krw, cuisine_category, active, photo_media_id")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (!options.includeInactive) query = query.eq("active", true);
    if (options.restaurantId) query = query.eq("restaurant_id", Number(options.restaurantId));
    if (options.menuId) query = query.eq("id", Number(options.menuId));
    const { data, error } = await query;
    if (error) throw new Error("메뉴 목록을 불러오지 못했어요.");
    const page = (data ?? []) as unknown as MenuRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchRestaurants(supabase: SupabaseServerClient, ids?: string[]) {
  const rows: RestaurantRow[] = [];
  if (ids) {
    for (const group of chunks([...new Set(ids)].filter(Boolean), SUMMARY_BATCH_SIZE)) {
      if (!group.length) continue;
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, description, address, region, latitude, longitude")
        .in("id", group.map(Number));
      if (error) throw new Error("가게 정보를 불러오지 못했어요.");
      rows.push(...((data ?? []) as unknown as RestaurantRow[]));
    }
    return rows;
  }

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, description, address, region, latitude, longitude")
      .order("name", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error("지역 목록을 불러오지 못했어요.");
    const page = (data ?? []) as unknown as RestaurantRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchSummaries(supabase: SupabaseServerClient, menuIds: string[]) {
  const summaries = new Map<string, SummaryRow>();
  const validIds = menuIds.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  for (const group of chunks(validIds, SUMMARY_BATCH_SIZE)) {
    if (!group.length) continue;
    const { data, error } = await supabase.rpc("get_menu_review_summaries", { p_menu_ids: group });
    if (error) throw new Error("메뉴 평점 정보를 불러오지 못했어요.");
    for (const row of (data ?? []) as unknown as SummaryRow[]) summaries.set(String(row.menu_id), row);
  }
  return summaries;
}

async function fetchSignedMenuImages(supabase: SupabaseServerClient, menus: MenuRow[]) {
  const mediaIds = [...new Set(menus.map((menu) => menu.photo_media_id).filter((id): id is string => Boolean(id)))];
  const mediaRows: MediaRow[] = [];
  for (const group of chunks(mediaIds, SUMMARY_BATCH_SIZE)) {
    if (!group.length) continue;
    const { data, error } = await supabase
      .from("media_assets")
      .select("id, object_path")
      .eq("media_kind", "MENU")
      .in("id", group);
    if (error) continue;
    mediaRows.push(...((data ?? []) as unknown as MediaRow[]));
  }

  const urls = new Map<string, string>();
  for (const group of chunks(mediaRows, SUMMARY_BATCH_SIZE)) {
    const paths = group.map((asset) => asset.object_path);
    if (!paths.length) continue;
    try {
      const { data } = await supabase.storage.from("yum-review-media").createSignedUrls(paths, SIGNED_READ_TTL_SECONDS);
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
      }
    } catch {
      // Keep catalog browsing available if a menu photo cannot be signed.
    }
  }

  const byId = new Map(mediaRows.map((asset) => [asset.id, asset.object_path]));
  const urlByMediaId = new Map<string, string>();
  for (const [id, path] of byId) {
    const url = urls.get(path);
    if (url) urlByMediaId.set(id, url);
  }
  return urlByMediaId;
}

async function fetchUserMenuIds(supabase: SupabaseServerClient, userId: string | null) {
  const reviewed = new Set<string>();
  const wishlisted = new Set<string>();
  if (!userId) return { reviewed, wishlisted };

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("reviews")
      .select("menu_id")
      .eq("user_id", userId)
      .order("menu_id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error("내 리뷰 목록을 불러오지 못했어요.");
    const page = (data ?? []) as Array<{ menu_id: number | string }>;
    page.forEach((row) => reviewed.add(String(row.menu_id)));
    if (page.length < PAGE_SIZE) break;
  }

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("menu_wishlists")
      .select("menu_id")
      .eq("user_id", userId)
      .order("menu_id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw new Error("찜한 메뉴 목록을 불러오지 못했어요.");
    const page = (data ?? []) as Array<{ menu_id: number | string }>;
    page.forEach((row) => wishlisted.add(String(row.menu_id)));
    if (page.length < PAGE_SIZE) break;
  }

  return { reviewed, wishlisted };
}

function haversineMeters(a: RestaurantSummary, latitude: number, longitude: number) {
  if (a.latitude === null || a.longitude === null) return null;
  const radians = (degrees: number) => degrees * (Math.PI / 180);
  const latDelta = radians(a.latitude - latitude);
  const lonDelta = radians(a.longitude - longitude);
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(a.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function sortMenus(items: MenuCatalogItem[], sort: CatalogSort) {
  const scoreField: Record<Exclude<CatalogSort, "reviewCount">, keyof MenuCatalogItem> = {
    overall: "score",
    taste: "tasteScore",
    value: "valueScore",
    portion: "portionScore",
  };
  return items.sort((a, b) => {
    if (sort === "reviewCount") {
      const difference = b.reviewCount - a.reviewCount;
      if (difference) return difference;
    } else {
      const field = scoreField[sort];
      const left = a[field] as number | null;
      const right = b[field] as number | null;
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      if (left !== null && right !== null && left !== right) return right - left;
    }
    return a.name.localeCompare(b.name, "ko")
      || a.restaurant.name.localeCompare(b.restaurant.name, "ko")
      || a.id.localeCompare(b.id, "en");
  });
}

async function hydrateMenus(
  supabase: SupabaseServerClient,
  menuRows: MenuRow[],
  restaurantRows: RestaurantRow[],
  userId: string | null,
) {
  const [summaries, imageUrls, userMenuIds] = await Promise.all([
    fetchSummaries(supabase, menuRows.map((menu) => safeId(menu.id)).filter(Boolean)),
    fetchSignedMenuImages(supabase, menuRows),
    fetchUserMenuIds(supabase, userId),
  ]);
  const restaurantsById = new Map(restaurantRows.map((row) => [String(row.id), {
    id: String(row.id),
    name: row.name,
    description: row.description,
    address: row.address,
    region: row.region,
    latitude: numeric(row.latitude),
    longitude: numeric(row.longitude),
  } satisfies RestaurantSummary]));

  return menuRows.flatMap((menu): MenuCatalogItem[] => {
    const id = safeId(menu.id);
    const restaurantId = safeId(menu.restaurant_id);
    const restaurant = restaurantsById.get(restaurantId);
    if (!id || !restaurantId || !restaurant) return [];
    const summary = summaries.get(id);
    return [{
      id,
      restaurantId,
      name: menu.name,
      description: menu.description,
      priceKrw: numeric(menu.price_krw),
      cuisineCategory: menu.cuisine_category,
      active: menu.active,
      score: numeric(summary?.overall_avg),
      tasteScore: numeric(summary?.taste_avg),
      valueScore: numeric(summary?.value_avg),
      portionScore: numeric(summary?.portion_avg),
      reviewCount: numeric(summary?.review_count) ?? 0,
      imageUrl: menu.photo_media_id ? imageUrls.get(menu.photo_media_id) ?? null : null,
      isWishlisted: userMenuIds.wishlisted.has(id),
      hasReviewed: userMenuIds.reviewed.has(id),
      restaurant,
    }];
  });
}

export async function loadDiscoveryCatalog(
  supabase: SupabaseServerClient,
  filters: CatalogFilters,
  userId: string | null,
  options: { includeInactive?: boolean } = {},
): Promise<DiscoveryResult> {
  const [menus, allRestaurants] = await Promise.all([
    fetchMenus(supabase, { includeInactive: options.includeInactive === true }),
    fetchRestaurants(supabase),
  ]);
  const restaurantIds = new Set(menus.map((menu) => safeId(menu.restaurant_id)).filter(Boolean));
  const restaurants = allRestaurants.filter((restaurant) => restaurantIds.has(String(restaurant.id)));
  const items = await hydrateMenus(supabase, menus, restaurants, userId);
  const regions = [...new Set(allRestaurants.map((row) => row.region?.trim()).filter((region): region is string => Boolean(region)))].sort((a, b) => a.localeCompare(b, "ko"));
  const query = filters.q.toLocaleLowerCase("ko");
  const radius = filters.radius === "all" ? null : Number(filters.radius);
  let excludedWithoutCoordinates = 0;

  const filtered = items.filter((item) => {
    if (filters.category && item.cuisineCategory !== filters.category) return false;
    if (filters.region && item.restaurant.region !== filters.region) return false;
    if (query && ![item.name, item.description, item.restaurant.name, item.restaurant.description, item.restaurant.address]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("ko").includes(query))) return false;
    if (radius !== null) {
      const distance = haversineMeters(item.restaurant, filters.latitude, filters.longitude);
      if (distance === null) {
        excludedWithoutCoordinates += 1;
        return false;
      }
      if (distance > radius) return false;
    }
    if (filters.mineReviews && !item.hasReviewed) return false;
    if (filters.wishlistedOnly && !item.isWishlisted) return false;
    return true;
  });

  return {
    items: sortMenus(filtered, filters.sort),
    regions,
    totalMenus: menus.length,
    excludedWithoutCoordinates,
  };
}

export async function loadRestaurant(supabase: SupabaseServerClient, restaurantId: string) {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, description, address, region, latitude, longitude")
    .eq("id", Number(restaurantId))
    .maybeSingle();
  if (error) throw new Error("가게 정보를 불러오지 못했어요.");
  const row = data as unknown as RestaurantRow | null;
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    address: row.address,
    region: row.region,
    latitude: numeric(row.latitude),
    longitude: numeric(row.longitude),
  } satisfies RestaurantSummary;
}

export async function loadRestaurantMenus(
  supabase: SupabaseServerClient,
  restaurantId: string,
  userId: string | null,
  includeInactive = false,
) {
  const [menus, restaurant] = await Promise.all([
    fetchMenus(supabase, { restaurantId, includeInactive }),
    loadRestaurant(supabase, restaurantId),
  ]);
  if (!restaurant || !menus.length) return { restaurant, items: [] as MenuCatalogItem[], editorMenus: [] as MenuEditorRow[] };
  const activeMenus = menus.filter((menu) => menu.active);
  const items = await hydrateMenus(supabase, activeMenus, [restaurant], userId);
  const editorMenus: MenuEditorRow[] = menus.map((menu) => ({
    id: safeId(menu.id),
    name: menu.name,
    description: menu.description ?? "",
    priceKrw: numeric(menu.price_krw),
    cuisineCategory: menu.cuisine_category,
    active: menu.active,
  })).filter((menu) => Boolean(menu.id));
  return { restaurant, items, editorMenus };
}

export type MenuEditorRow = {
  id: string;
  name: string;
  description: string;
  priceKrw: number | null;
  cuisineCategory: string;
  active: boolean;
};

export async function loadMenuById(supabase: SupabaseServerClient, menuId: string, userId: string | null) {
  const menus = await fetchMenus(supabase, { menuId, includeInactive: true });
  if (!menus.length) return null;
  const menu = menus[0];
  const restaurants = await fetchRestaurants(supabase, [safeId(menu.restaurant_id)]);
  const hydrated = await hydrateMenus(supabase, menus, restaurants, userId);
  return hydrated[0] ?? null;
}

export async function loadRestaurantRegions(supabase: SupabaseServerClient) {
  const rows = await fetchRestaurants(supabase);
  return [...new Set(rows.map((row) => row.region?.trim()).filter((region): region is string => Boolean(region)))].sort((a, b) => a.localeCompare(b, "ko"));
}
