"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CatalogFilters, MenuCatalogItem } from "@/lib/data/catalog";
import type { PlaceSuggestion } from "@/lib/data/location";
import { hasValidCoordinates, type Coordinates } from "@/lib/location/distance";
import { MenuCard } from "@/components/catalog/MenuCard";
import { PersonalFilters } from "@/components/catalog/PersonalFilters";
import { PlaceSearch } from "./PlaceSearch";
import styles from "./discovery.module.css";

type DiscoveryFiltersProps = {
  initial: CatalogFilters;
  regions: string[];
  authenticated: boolean;
  items?: MenuCatalogItem[];
  campus?: { label: string; latitude: number; longitude: number } | undefined;
  fixedPersonalFilter?: "mineReviews" | "wishlistedOnly";
  showPersonalFilters?: boolean;
  heading?: string;
};

const RADIUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "300", label: "300m" },
  { value: "500", label: "500m" },
  { value: "1000", label: "1km" },
] as const;

const SORT_OPTIONS = [
  { value: "overall", label: "전체 평점순" },
  { value: "taste", label: "맛 평점순" },
  { value: "value", label: "가성비 평점순" },
  { value: "portion", label: "양 평점순" },
  { value: "reviewCount", label: "리뷰 많은 순" },
] as const;

export function DiscoveryFilters({
  initial,
  regions,
  authenticated,
  items,
  fixedPersonalFilter,
  showPersonalFilters = true,
  heading = "오늘 먹을 메뉴를 찾아요",
}: DiscoveryFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [region, setRegion] = useState(initial.region);
  const [radius, setRadius] = useState<CatalogFilters["radius"]>("all");
  const [sort, setSort] = useState(initial.sort);
  const [mineReviews, setMineReviews] = useState(initial.mineReviews);
  const [wishlistedOnly, setWishlistedOnly] = useState(initial.wishlistedOnly);
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [place, setPlace] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [locationPending, setLocationPendingState] = useState(false);
  const [serverRestaurantIds, setServerRestaurantIds] = useState<Set<string> | null>(null);
  const [distancePending, setDistancePending] = useState(false);
  const [distanceMessage, setDistanceMessage] = useState("");
  const locationRequest = useRef(0);
  const locationRequestController = useRef<AbortController | null>(null);
  const locationPendingRef = useRef(false);
  const originRef = useRef<Coordinates | null>(null);
  const placeRef = useRef("");
  const urlRadius = useRef<CatalogFilters["radius"]>("all");

  function setCurrentPlace(value: string) {
    placeRef.current = value;
    setPlace(value);
  }

  function setLocationIsPending(value: boolean) {
    locationPendingRef.current = value;
    setLocationPendingState(value);
  }

  function cancelLocationRequest() {
    const hadLocationPending = locationPendingRef.current;
    locationRequest.current += 1;
    locationRequestController.current?.abort();
    locationRequestController.current = null;
    setLocationIsPending(false);
    setDistancePending(false);
    if (hadLocationPending) setLocationMessage("");
    return locationRequest.current;
  }

  function removeRadiusFromUrl() {
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has("radius")) return;
    currentUrl.searchParams.delete("radius");
    const search = currentUrl.searchParams.toString();
    const href = `${currentUrl.pathname}${search ? `?${search}` : ""}${currentUrl.hash}`;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function normalizeRadiusWithoutOrigin() {
    cancelLocationRequest();
    urlRadius.current = "all";
    setRadius("all");
    if (placeRef.current === "현재 위치 주소 확인 중…") setCurrentPlace("현재 위치");
    setServerRestaurantIds(null);
    setDistanceMessage("");
    removeRadiusFromUrl();
  }

  useEffect(() => {
    setQuery(initial.q);
    setCategory(initial.category);
    setRegion(initial.region);
    setSort(initial.sort);
    setMineReviews(initial.mineReviews);
    setWishlistedOnly(initial.wishlistedOnly);
  }, [initial.q, initial.category, initial.region, initial.sort, initial.mineReviews, initial.wishlistedOnly]);

  function navigate(next: Partial<{
    q: string;
    category: string;
    region: string;
    radius: CatalogFilters["radius"];
    sort: CatalogFilters["sort"];
    mineReviews: boolean;
    wishlistedOnly: boolean;
  }> = {}) {
    const values = {
      q: query,
      category,
      region,
      radius,
      sort,
      mineReviews: fixedPersonalFilter === "mineReviews" || mineReviews,
      wishlistedOnly: fixedPersonalFilter === "wishlistedOnly" || wishlistedOnly,
      ...next,
    };
    const params = new URLSearchParams();
    if (values.q.trim()) params.set("q", values.q.trim());
    if (values.category) params.set("category", values.category);
    if (values.region) params.set("region", values.region);
    if (values.radius !== "all") params.set("radius", values.radius);
    if (values.sort !== "overall") params.set("sort", values.sort);
    if (values.mineReviews) params.set("mineReviews", "1");
    if (values.wishlistedOnly) params.set("wishlistedOnly", "1");
    const search = params.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate();
  }

  async function requestServerLocation(
    coordinates: Coordinates,
    radiusValue: CatalogFilters["radius"],
    includeAddress: boolean,
    requestId: number,
  ) {
    const radiusMeters = radiusValue === "all" ? null : Number(radiusValue);
    const controller = new AbortController();
    locationRequestController.current = controller;
    setDistanceMessage("");
    setServerRestaurantIds(null);
    setDistancePending(radiusMeters !== null);
    if (includeAddress) setLocationIsPending(true);

    try {
      const response = await fetch("/api/location/reverse", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          includeAddress,
          ...(radiusMeters === null ? {} : { radiusMeters }),
        }),
      });
      const result = await response.json() as {
        success?: boolean;
        address?: string | null;
        message?: string | null;
        distanceSuccess?: boolean;
        distanceMessage?: string | null;
        restaurantIds?: unknown;
      };
      if (requestId !== locationRequest.current) return;

      if (includeAddress) {
        if (response.ok && result.success && result.address) {
          setCurrentPlace(result.address);
          setLocationMessage("현재 위치 주소를 확인했어요. 좌표는 서버에서 거리 계산에 임시 사용돼요.");
        } else {
          setCurrentPlace("현재 위치");
          setLocationMessage(result.message ?? "현재 위치를 거리 기준으로 사용하고 주소 표시는 건너뛰었어요.");
        }
      }

      if (radiusMeters !== null) {
        const validIds = Array.isArray(result.restaurantIds)
          && result.restaurantIds.every((id) => typeof id === "string" && /^\d+$/.test(id));
        if (response.ok && result.distanceSuccess && validIds) {
          setServerRestaurantIds(new Set(result.restaurantIds as string[]));
        } else {
          setServerRestaurantIds(new Set());
          setDistanceMessage(result.distanceMessage ?? result.message ?? "거리 검색 정보를 확인하지 못했어요. 다시 시도해 주세요.");
        }
      }
    } catch {
      if (requestId !== locationRequest.current) return;
      if (includeAddress) {
        setCurrentPlace("현재 위치");
        setLocationMessage("현재 위치를 거리 기준으로 사용하고 주소 표시는 건너뛰었어요.");
      }
      if (radiusMeters !== null) {
        setServerRestaurantIds(new Set());
        setDistanceMessage("거리 검색 정보를 확인하지 못했어요. 다시 시도해 주세요.");
      }
    } finally {
      if (locationRequestController.current === controller) locationRequestController.current = null;
      if (requestId === locationRequest.current) {
        if (includeAddress) setLocationIsPending(false);
        if (radiusMeters !== null) setDistancePending(false);
      }
    }
  }

  function useCurrentLocation() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocationIsPending(false);
      setLocationMessage("이 브라우저에서는 현재 위치를 사용할 수 없어요. 주소를 검색해 주세요.");
      return;
    }

    const requestId = cancelLocationRequest();
    setLocationIsPending(true);
    setLocationMessage("브라우저 위치 권한을 기다리고 있어요.");
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
        if (requestId !== locationRequest.current) return;
        const latitude = coords.latitude;
        const longitude = coords.longitude;
        if (!hasValidCoordinates(latitude, longitude)) {
          setLocationIsPending(false);
          setLocationMessage("현재 위치 좌표를 확인할 수 없어요. 주소를 검색해 주세요.");
          return;
        }
        const coordinates = { latitude, longitude };
        originRef.current = coordinates;
        setOrigin(coordinates);
        setCurrentPlace("현재 위치 주소 확인 중…");
        setLocationMessage("현재 위치를 거리 기준으로 사용해요. 주소 표시를 확인하고 있어요.");
        void requestServerLocation(coordinates, radius, true, requestId);
        },
        (error) => {
        if (requestId !== locationRequest.current) return;
        setLocationIsPending(false);
        const message = error.code === error.PERMISSION_DENIED
          ? "위치 권한을 허용하지 않았어요. 주소를 검색해 주세요."
          : error.code === error.TIMEOUT
            ? "현재 위치를 확인하지 못했어요. 다시 시도해 주세요."
            : "현재 위치를 사용할 수 없어요. 주소를 검색해 주세요.";
        setLocationMessage(message);
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
      );
    } catch {
      if (requestId === locationRequest.current) {
        setLocationIsPending(false);
        setLocationMessage("현재 위치를 사용할 수 없어요. 주소를 검색해 주세요.");
      }
    }
  }

  function selectPlace(selected: PlaceSuggestion) {
    if (selected.latitude === null || selected.longitude === null
        || !hasValidCoordinates(selected.latitude, selected.longitude)) return;
    const requestId = cancelLocationRequest();
    const coordinates = { latitude: selected.latitude, longitude: selected.longitude };
    originRef.current = coordinates;
    setOrigin(coordinates);
    setCurrentPlace(selected.roadAddress || selected.address || selected.name || "선택한 주소");
    setLocationMessage("선택한 주소 좌표는 거리 계산에만 임시 사용해요.");
    if (radius !== "all") void requestServerLocation(coordinates, radius, false, requestId);
    else {
      setServerRestaurantIds(null);
      setDistancePending(false);
      setDistanceMessage("");
    }
  }

  function changeRadius(value: CatalogFilters["radius"]) {
    if (!originRef.current && value !== "all") {
      normalizeRadiusWithoutOrigin();
      return;
    }
    navigate({ radius: value });
    applyUrlRadius(value);
  }

  function applyUrlRadius(value: CatalogFilters["radius"], force = false) {
    if (!originRef.current && value !== "all") {
      normalizeRadiusWithoutOrigin();
      return;
    }
    if (urlRadius.current === value && !force) return;
    urlRadius.current = value;
    setRadius(value);
    const requestId = cancelLocationRequest();
    if (placeRef.current === "현재 위치 주소 확인 중…") setCurrentPlace("현재 위치");
    const coordinates = originRef.current;
    if (!coordinates || value === "all") {
      setServerRestaurantIds(null);
      setDistanceMessage("");
      return;
    }
    void requestServerLocation(coordinates, value, false, requestId);
  }

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("radius");
    if (!originRef.current && selected !== null) {
      normalizeRadiusWithoutOrigin();
      return;
    }
    applyUrlRadius(initial.radius);
  }, [initial.radius]);

  useEffect(() => {
    function restoreRadiusFromHistory() {
      const params = new URLSearchParams(window.location.search);
      const selected = params.get("radius");
      const value = RADIUS_OPTIONS.some((option) => option.value === selected)
        ? selected as CatalogFilters["radius"]
        : "all";
      cancelLocationRequest();
      if (!originRef.current && params.has("radius")) {
        normalizeRadiusWithoutOrigin();
        return;
      }
      applyUrlRadius(value, true);
    }

    window.addEventListener("popstate", restoreRadiusFromHistory);
    return () => window.removeEventListener("popstate", restoreRadiusFromHistory);
  }, []);

  function handlePersonalChange(next: { mineReviews: boolean; wishlistedOnly: boolean }) {
    setMineReviews(next.mineReviews);
    setWishlistedOnly(next.wishlistedOnly);
    navigate(next);
  }

  function loginForPersonalFilter() {
    if (typeof window === "undefined") return;
    const destination = window.location.pathname + window.location.search;
    window.location.assign(`/login?next=${encodeURIComponent(destination)}`);
  }

  function resetFilters() {
    cancelLocationRequest();
    setQuery("");
    setCategory("");
    setRegion("");
    setRadius("all");
    urlRadius.current = "all";
    setSort("overall");
    originRef.current = null;
    setOrigin(null);
    setCurrentPlace("");
    setServerRestaurantIds(null);
    setDistancePending(false);
    setDistanceMessage("");
    setMineReviews(fixedPersonalFilter === "mineReviews");
    setWishlistedOnly(fixedPersonalFilter === "wishlistedOnly");
    setLocationMessage("");
    const params = new URLSearchParams();
    if (fixedPersonalFilter === "mineReviews") params.set("mineReviews", "1");
    if (fixedPersonalFilter === "wishlistedOnly") params.set("wishlistedOnly", "1");
    const search = params.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname));
  }

  const displayedItems = useMemo(() => {
    if (!items || !origin || radius === "all") return items ?? [];
    if (distancePending || serverRestaurantIds === null) return [];
    return items.filter((item) => serverRestaurantIds.has(item.restaurantId));
  }, [items, origin, radius, distancePending, serverRestaurantIds]);

  return (
    <>
      <section className={styles.filters} aria-labelledby="discovery-filters-title">
        <div className={styles.filterHeading}>
          <div>
            <p className={styles.eyebrow}>메뉴 둘러보기</p>
            <h2 id="discovery-filters-title">{heading}</h2>
          </div>
          <button className={styles.textButton} type="button" onClick={resetFilters}>필터 초기화</button>
        </div>

        <form onSubmit={submit}>
          <div className={styles.filterGrid}>
            <label className={`${styles.field} ${styles.queryField}`}>
              메뉴·가게 검색
              <input className={styles.input} type="search" maxLength={120} value={query}
                onChange={(event) => setQuery(event.target.value)} placeholder="메뉴 이름, 가게 이름, 주소" />
            </label>
            <label className={styles.field}>
              음식 종류
              <select className={styles.select} value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">모든 종류</option>
                <option value="KOREAN">한식</option>
                <option value="WESTERN">양식</option>
                <option value="CHINESE">중식</option>
                <option value="JAPANESE">일식</option>
                <option value="SNACK">분식</option>
                <option value="PUB">주점</option>
                <option value="CAFE">카페·디저트</option>
                <option value="OTHER">기타</option>
              </select>
            </label>
            <label className={styles.field}>
              지역
              <select className={styles.select} value={region} onChange={(event) => setRegion(event.target.value)}>
                <option value="">모든 지역</option>
                {regions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              정렬
              <select className={styles.select} value={sort} onChange={(event) => setSort(event.target.value as CatalogFilters["sort"])}>
                {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <p id="location-disclosure" className={styles.locationDisclosure}>
            현재 위치를 선택하면 임시 좌표가 거리 필터 계산을 위해 한입 앱 서버로 전송되고, 주소 표시를 요청하면 좌표가 앱 서버를 거쳐 VWorld 요청 URL로 전달돼요. 좌표는 브라우저 주소·저장소·DB·앱 로그·텔레메트리에는 저장하지 않아요.
          </p>
          <div className={styles.locationRow}>
            <label className={styles.field}>
              거리 반경
              <select className={styles.select} value={radius} disabled={locationPending} onChange={(event) => {
                const value = event.target.value as CatalogFilters["radius"];
                changeRadius(value);
              }}>
                {RADIUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} disabled={!origin && option.value !== "all"}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className={styles.centerLabel}>
              <span>기준 위치</span>
              <strong>{place || "선택하지 않음"}</strong>
            </p>
            <button className={styles.secondaryButton} type="button" onClick={useCurrentLocation} disabled={locationPending} aria-busy={locationPending} aria-describedby="location-disclosure">
              {locationPending ? "위치 확인 중…" : "현재 위치로"}
            </button>
            <button className={styles.primaryButton} type="submit" disabled={isPending}>
              {isPending ? "적용 중…" : "필터 적용"}
            </button>
          </div>
        </form>

        <p className={styles.statusMessage} role="status" aria-live="polite">{locationMessage}</p>
        {radius !== "all" && !origin ? <p className={styles.locationHint} role="status">거리 반경을 적용하려면 현재 위치 권한을 허용하거나 주소를 검색해 주세요.</p> : null}
        <PlaceSearch onSelect={selectPlace} />
        {showPersonalFilters ? (
          <div className={styles.personalFilterWrap}>
            <PersonalFilters
              mineReviews={mineReviews}
              wishlistedOnly={wishlistedOnly}
              onChange={handlePersonalChange}
              authenticated={authenticated}
              onLoginRequired={loginForPersonalFilter}
            />
          </div>
        ) : null}
        <p className={styles.filterNote}>등록된 가게 좌표가 없는 메뉴는 거리 필터에서 제외돼요.</p>
      </section>

      {items ? (
        <section className={styles.results} aria-labelledby="results-title">
          <div className={styles.resultsHeading}>
            <div>
              <p className={styles.eyebrow}>찾은 메뉴</p>
              <h2 id="results-title">{initial.q ? `“${initial.q}” 검색 결과` : initial.region || "메뉴 목록"}</h2>
            </div>
            <p aria-live="polite">{displayedItems.length.toLocaleString("ko-KR")}개 메뉴</p>
          </div>

          {distanceMessage ? <p className={styles.locationHint} role="alert">{distanceMessage}</p> : null}

          {distancePending ? (
            <div className={styles.stateCard} role="status"><h3>거리 기준을 확인하고 있어요.</h3><p>가게 위치를 서버에서 계산하고 있어요.</p></div>
          ) : displayedItems.length ? (
            <div className={styles.menuGrid}>
              {displayedItems.map((item) => (
                <MenuCard
                  key={item.id}
                  menuId={Number(item.id)}
                  name={item.name}
                  restaurantName={item.restaurant.name}
                  priceKrw={item.priceKrw}
                  cuisineCategory={item.cuisineCategory}
                  score={item.score}
                  reviewCount={item.reviewCount}
                  imageUrl={item.imageUrl}
                  isWishlisted={item.isWishlisted}
                  hasReviewed={item.hasReviewed}
                />
              ))}
            </div>
          ) : (
            <div className={styles.stateCard}>
              <h3>조건에 맞는 메뉴가 없어요.</h3>
              <p>검색어나 거리 반경을 바꾸면 다른 메뉴를 찾을 수 있어요.</p>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
