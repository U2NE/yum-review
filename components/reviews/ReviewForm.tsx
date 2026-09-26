"use client";

import { useId, useState, type KeyboardEvent, type FormEvent } from "react";
import type { ReviewSavePayload } from "@/lib/data/reviews";

type InitialReview = {
  id?: number;
  overall_score?: number | null;
  taste_score?: number | null;
  value_score?: number | null;
  portion_score?: number | null;
  comment?: string | null;
  non_event_review_consent?: boolean | null;
};

type ReviewFormProps = {
  menuId: number;
  initialReview?: InitialReview;
  onSave: (payload: ReviewSavePayload) => void | Promise<void>;
  onCancel?: () => void;
};

type ScoreField = "overallScore" | "tasteScore" | "valueScore" | "portionScore";

const categories: Array<{ key: ScoreField; label: string }> = [
  { key: "overallScore", label: "전체" },
  { key: "tasteScore", label: "맛" },
  { key: "valueScore", label: "가성비" },
  { key: "portionScore", label: "양" },
];

const starPath = "M12 2.4 14.9 8.3l6.5.9-4.7 4.6 1.1 6.5L12 17.2l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.4Z";

function RatingControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (score: number | null) => void;
}) {
  const groupId = useId();
  const values = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);
  const focusValue = (score: number) => {
    requestAnimationFrame(() => {
      document.getElementById(`${groupId}-${score}`)?.focus();
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
    const currentIndex = values.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") nextIndex = Math.min(9, currentIndex + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = 9;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = values[nextIndex];
    onChange(next);
    focusValue(next);
  };

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ fontWeight: 700, padding: 0, marginBottom: 0.35 }}>{label}</legend>
      <div
        role="radiogroup"
        aria-label={`${label} 별점`}
        style={{ display: "flex", alignItems: "center", gap: 0.1 }}
      >
        {Array.from({ length: 5 }, (_, starIndex) => {
          const fill = Math.max(0, Math.min(1, (value ?? 0) - starIndex));
          return (
            <span
              key={starIndex}
              style={{
                position: "relative",
                display: "inline-block",
                width: "2.15rem",
                height: "2.3rem",
                flex: "0 0 2.15rem",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ position: "absolute", inset: "0.1rem", width: "1.95rem", height: "1.95rem" }}
              >
                <path d={starPath} fill="#e4ddd2" stroke="#a99f91" strokeWidth="0.5" />
              </svg>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: "0.1rem auto auto 0.1rem",
                  width: `${fill * 1.95}rem`,
                  height: "1.95rem",
                  overflow: "hidden",
                  pointerEvents: "none",
                }}
              >
                <svg viewBox="0 0 24 24" style={{ width: "1.95rem", height: "1.95rem", maxWidth: "none" }}>
                  <path d={starPath} fill="#a7472c" stroke="#7e321f" strokeWidth="0.5" />
                </svg>
              </span>
              {[0, 1].map((half) => {
                const score = starIndex + (half === 0 ? 0.5 : 1);
                const isSelected = value === score;
                const isTabStop = isSelected || (value === null && score === 0.5);
                return (
                  <button
                    key={half}
                    id={`${groupId}-${score}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`${label} ${score.toFixed(1)}점`}
                    title={`${score.toFixed(1)}점`}
                    tabIndex={isTabStop ? 0 : -1}
                    onKeyDown={(event) => handleKeyDown(event, score)}
                    onClick={() => onChange(value === score ? null : score)}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: half === 0 ? 0 : "50%",
                      width: "50%",
                      border: 0,
                      borderRadius: "0.2rem",
                      padding: 0,
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </span>
          );
        })}
      </div>
      <span aria-live="polite" style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
        {value === null ? "미평가" : `${value.toFixed(1)}점`}
        {" · 같은 별점을 다시 누르면 미평가로 바뀝니다"}
      </span>
    </fieldset>
  );
}

export function ReviewForm({ menuId, initialReview, onSave, onCancel }: ReviewFormProps) {
  const [scores, setScores] = useState<Record<ScoreField, number | null>>({
    overallScore: initialReview?.overall_score ?? null,
    tasteScore: initialReview?.taste_score ?? null,
    valueScore: initialReview?.value_score ?? null,
    portionScore: initialReview?.portion_score ?? null,
  });
  const [comment, setComment] = useState(initialReview?.comment ?? "");
  const [consented, setConsented] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setScore = (key: ScoreField, score: number | null) => {
    setScores((current) => ({ ...current, [key]: score }));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (scores.overallScore === null) {
      setError("전체 별점을 선택해 주세요.");
      return;
    }
    if (!consented) {
      setError("이벤트 참여 없이 작성한 리뷰인지 확인해 주세요.");
      return;
    }
    if ([...comment].length > 1000) {
      setError("코멘트는 1,000자까지 입력할 수 있어요.");
      return;
    }

    setPending(true);
    try {
      await onSave({
        menuId,
        overallScore: scores.overallScore,
        tasteScore: scores.tasteScore,
        valueScore: scores.valueScore,
        portionScore: scores.portionScore,
        comment: comment.trim() || null,
        nonEventConsent: true,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "리뷰를 저장하지 못했어요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.05rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem 2rem" }}>
        {categories.map((category) => (
          <RatingControl
            key={category.key}
            label={category.label}
            value={scores[category.key]}
            onChange={(score) => setScore(category.key, score)}
          />
        ))}
      </div>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
        2.5점을 평균이라고 생각하고, 실제 경험을 기준으로 별점을 매겨 주세요.
      </p>
      <label style={{ display: "grid", gap: "0.35rem", fontWeight: 650 }}>
        코멘트 <span style={{ color: "var(--muted)", fontWeight: 400 }}>선택 · 최대 1,000자</span>
        <textarea
          value={comment}
          onChange={(event) => setComment([...event.target.value].slice(0, 1000).join(""))}
          maxLength={2000}
          rows={4}
          style={{
            width: "100%",
            resize: "vertical",
            border: "1px solid var(--line)",
            borderRadius: "0.65rem",
            padding: "0.75rem",
            background: "var(--surface)",
          }}
        />
        <span aria-live="polite" style={{ justifySelf: "end", color: "var(--muted)", fontSize: "0.86rem", fontWeight: 400 }}>
          {[...comment].length}/1,000
        </span>
      </label>
      <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
          required
          style={{ marginTop: "0.32rem" }}
        />
        <span>이 리뷰는 이벤트 참여나 대가 없이 작성했어요. (필수)</span>
      </label>
      {error ? <p role="alert" style={{ margin: 0, color: "#9a2e20" }}>{error}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
        <button type="submit" disabled={pending} style={primaryButton}>
          {pending ? "저장 중…" : initialReview ? "리뷰 수정 저장" : "리뷰 등록"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={pending} style={secondaryButton}>
            취소
          </button>
        ) : null}
      </div>
    </form>
  );
}

const primaryButton = {
  border: "1px solid var(--accent)",
  borderRadius: "999px",
  background: "var(--accent)",
  color: "white",
  padding: "0.55rem 1rem",
  fontWeight: 700,
  cursor: "pointer",
} as const;

const secondaryButton = {
  border: "1px solid var(--line)",
  borderRadius: "999px",
  background: "var(--surface)",
  padding: "0.55rem 1rem",
  cursor: "pointer",
} as const;
