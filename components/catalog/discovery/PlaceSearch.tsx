"use client";

import { useState } from "react";
import type { PlaceSuggestion } from "@/lib/data/location";
import styles from "./discovery.module.css";

type PlaceSearchPayload = {
  configured: boolean;
  success: boolean;
  message: string | null;
  results: PlaceSuggestion[];
};

export function PlaceSearch({
  onSelect,
}: {
  onSelect: (place: PlaceSuggestion) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = query.trim();
    if (!cleaned) {
      setMessage("장소 이름이나 주소를 입력해 주세요.");
      setResults([]);
      return;
    }
    if (cleaned.length > 160) {
      setMessage("주소는 160자 이내로 입력해 주세요.");
      setResults([]);
      return;
    }

    setPending(true);
    setMessage("");
    setResults([]);
    try {
      const response = await fetch(`/api/location/search?q=${encodeURIComponent(cleaned)}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as PlaceSearchPayload;
      setResults(payload.success ? payload.results : []);
      setMessage(payload.message ?? "");
    } catch {
      setMessage("장소 검색을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.placeSearch} aria-labelledby="place-search-title">
      <h3 id="place-search-title">주소로 거리 기준 정하기</h3>
      <form className={styles.placeForm} onSubmit={search}>
        <label className={styles.visuallyHidden} htmlFor="place-query">주소 검색</label>
        <input
          id="place-query"
          className={styles.input}
          type="search"
          maxLength={160}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="예: 서울 중구 세종대로 110"
        />
        <button className={styles.secondaryButton} type="submit" disabled={pending}>
          {pending ? "주소 확인 중…" : "주소 찾기"}
        </button>
      </form>
      {message ? <p className={styles.placeMessage} role="status">{message}</p> : null}
      {results.length ? (
        <ul className={styles.placeResults} aria-label="장소 검색 결과">
          {results.map((place, index) => {
            const canSelect = place.latitude !== null && place.longitude !== null;
            return (
              <li key={`${place.name}-${place.address}-${index}`}>
                <button
                  className={styles.placeResult}
                  type="button"
                  disabled={!canSelect}
                  onClick={() => onSelect(place)}
                >
                  <span className={styles.placeResultName}>{place.name || "이름 없는 장소"}</span>
                  <span>{place.roadAddress || place.address || "주소 정보 없음"}</span>
                  {place.category ? <small>{place.category}</small> : null}
                  {!canSelect ? <small>위치 정보가 없어 중심으로 선택할 수 없어요.</small> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
