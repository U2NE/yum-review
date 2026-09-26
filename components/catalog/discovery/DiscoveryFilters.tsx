"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CatalogFilters } from "@/lib/data/catalog";
import type { PlaceSuggestion } from "@/lib/data/location";
import { PersonalFilters } from "@/components/catalog/PersonalFilters";
import { PlaceSearch } from "./PlaceSearch";
import styles from "./discovery.module.css";

type DiscoveryFiltersProps = {
  initial: CatalogFilters;
  regions: string[];
  authenticated: boolean;
  campus: { label: string; latitude: number; longitude: number };
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
  campus,
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
  const [radius, setRadius] = useState(initial.radius);
  const [latitude, setLatitude] = useState(initial.latitude);
  const [longitude, setLongitude] = useState(initial.longitude);
  const [place, setPlace] = useState(initial.place || campus.label);
  const [sort, setSort] = useState(initial.sort);
  const [mineReviews, setMineReviews] = useState(initial.mineReviews);
  const [wishlistedOnly, setWishlistedOnly] = useState(initial.wishlistedOnly);
  const [locationMessage, setLocationMessage] = useState("");

  useEffect(() => {
    setQuery(initial.q);
    setCategory(initial.category);
    setRegion(initial.region);
    setRadius(initial.radius);
    setLatitude(initial.latitude);
    setLongitude(initial.longitude);
    setPlace(initial.place || campus.label);
    setSort(initial.sort);
    setMineReviews(initial.mineReviews);
    setWishlistedOnly(initial.wishlistedOnly);
  }, [initial, campus.label, campus.latitude, campus.longitude]);

  function navigate(next: Partial<{
    q: string;
    category: string;
    region: string;
    radius: CatalogFilters["radius"];
    latitude: number;
    longitude: number;
    place: string;
    sort: CatalogFilters["sort"];
    mineReviews: boolean;
    wishlistedOnly: boolean;
  }> = {}) {
    const values = {
      q: query,
      category,
      region,
      radius,
      latitude,
      longitude,
      place,
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
    if (values.latitude !== campus.latitude || values.longitude !== campus.longitude || values.place !== campus.label) {
      params.set("lat", String(values.latitude));
      params.set("lon", String(values.longitude));
      params.set("place", values.place.slice(0, 80));
    }
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

  function useCurrentLocation() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocationMessage("이 브라우저에서는 현재 위치를 사용할 수 없어요. 장소를 검색해 주세요.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setPlace("현재 위치");
        setLocationMessage("현재 위치를 중심으로 선택했어요.");
        navigate({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          place: "현재 위치",
        });
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "위치 권한을 허용하지 않았어요. 장소 검색이나 캠퍼스 중심을 이용해 주세요."
          : error.code === error.TIMEOUT
            ? "현재 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."
            : "현재 위치를 사용할 수 없어요. 장소를 검색해 주세요.";
        setLocationMessage(message);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  function selectPlace(selected: PlaceSuggestion) {
    if (selected.latitude === null || selected.longitude === null) return;
    setLatitude(selected.latitude);
    setLongitude(selected.longitude);
    setPlace(selected.name || "선택한 장소");
    setLocationMessage("선택한 장소를 중심으로 메뉴를 찾을게요.");
    navigate({ latitude: selected.latitude, longitude: selected.longitude, place: selected.name || "선택한 장소" });
  }

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
    setQuery("");
    setCategory("");
    setRegion("");
    setRadius("all");
    setLatitude(campus.latitude);
    setLongitude(campus.longitude);
    setPlace(campus.label);
    setSort("overall");
    setMineReviews(fixedPersonalFilter === "mineReviews");
    setWishlistedOnly(fixedPersonalFilter === "wishlistedOnly");
    setLocationMessage("");
    const params = new URLSearchParams();
    if (fixedPersonalFilter === "mineReviews") params.set("mineReviews", "1");
    if (fixedPersonalFilter === "wishlistedOnly") params.set("wishlistedOnly", "1");
    const search = params.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname));
  }

  return (
    <section className={styles.filters} aria-labelledby="discovery-filters-title">
      <div className={styles.filterHeading}>
        <div>
          <p className={styles.eyebrow}>메뉴 둘러보기</p>
          <h2 id="discovery-filters-title">{heading}</h2>
        </div>
        <button className={styles.textButton} type="button" onClick={resetFilters}>
          필터 초기화
        </button>
      </div>

      <form onSubmit={submit}>
        <div className={styles.filterGrid}>
          <label className={`${styles.field} ${styles.queryField}`}>
            메뉴·가게 검색
            <input
              className={styles.input}
              type="search"
              maxLength={120}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="메뉴 이름, 가게 이름, 주소"
            />
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

        <div className={styles.locationRow}>
          <label className={styles.field}>
            거리 반경
            <select className={styles.select} value={radius} onChange={(event) => setRadius(event.target.value as CatalogFilters["radius"])}>
              {RADIUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <p className={styles.centerLabel}>
            <span>기준 위치</span>
            <strong>{place}</strong>
          </p>
          <button className={styles.secondaryButton} type="button" onClick={useCurrentLocation}>
            현재 위치로
          </button>
          <button className={styles.primaryButton} type="submit" disabled={isPending}>
            {isPending ? "적용 중…" : "필터 적용"}
          </button>
        </div>
      </form>

      {locationMessage ? <p className={styles.statusMessage} role="status">{locationMessage}</p> : null}
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
      <p className={styles.filterNote}>
        반경은 가게 위치를 기준으로 계산해요. 위치 정보가 없는 가게는 거리 필터에서 제외될 수 있어요.
      </p>
    </section>
  );
}
