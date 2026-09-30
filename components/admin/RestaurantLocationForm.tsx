"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./restaurant-location.module.css";

export function RestaurantLocationForm({
  restaurantId,
  address: initialAddress,
  hasCoordinates,
}: {
  restaurantId: string;
  address: string | null;
  hasCoordinates: boolean;
}) {
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress ?? "");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsError(false);
    const cleaned = address.trim();
    if (!cleaned || cleaned.length > 160) {
      setIsError(true);
      setMessage("주소를 160자 이내로 입력해 주세요.");
      return;
    }
    if (!consent) {
      setIsError(true);
      setMessage("가게 위치 저장에 동의해야 등록할 수 있어요.");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/restaurants/${encodeURIComponent(restaurantId)}/location`, {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ address: cleaned, consent: true }),
      });
      const result = await response.json() as { success?: boolean; message?: string; error?: string };
      if (!response.ok || result.success !== true) throw new Error(result.error ?? "가게 위치를 저장하지 못했어요.");
      setAddress(cleaned);
      setConsent(false);
      setMessage(result.message ?? "가게 주소와 위치를 저장했어요.");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "가게 위치를 저장하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.locationCard} aria-labelledby="restaurant-location-title">
      <div>
        <p className={styles.eyebrow}>거리 탐색</p>
        <h2 id="restaurant-location-title">가게 위치 등록</h2>
        <p className={styles.description}>
          주소를 좌표로 변환해 가게 정보에 저장하고, 방문자가 거리로 메뉴를 찾을 때 사용해요.
          {hasCoordinates ? " 주소를 바꾸면 위치 좌표도 함께 갱신돼요." : " 주소와 위치를 등록해 주세요."}
        </p>
      </div>
      <form className={styles.form} onSubmit={save}>
        <label className={styles.field} htmlFor={`restaurant-address-${restaurantId}`}>
          가게 주소
          <input
            id={`restaurant-address-${restaurantId}`}
            className={styles.input}
            type="text"
            autoComplete="street-address"
            maxLength={160}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="예: 서울 중구 세종대로 110"
            required
          />
        </label>
        <label className={styles.consent}>
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
          <span>주소를 좌표로 변환해 가게 위치로 저장하고 거리 계산에 사용하는 데 동의합니다. (필수)</span>
        </label>
        <div className={styles.actions}>
          <button className={styles.submit} type="submit" disabled={pending || !consent} style={{ minHeight: "44px" }}>
            {pending ? "주소 확인 중…" : hasCoordinates ? "주소와 위치 저장" : "주소와 위치 등록"}
          </button>
          {message ? <p className={isError ? styles.error : styles.success} role={isError ? "alert" : "status"}>{message}</p> : null}
        </div>
      </form>
    </section>
  );
}
