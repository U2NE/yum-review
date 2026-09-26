"use client";

export type PersonalFilterState = { mineReviews: boolean; wishlistedOnly: boolean };

export function PersonalFilters({
  mineReviews,
  wishlistedOnly,
  onChange,
  authenticated,
  onLoginRequired,
}: {
  mineReviews: boolean;
  wishlistedOnly: boolean;
  onChange: (next: PersonalFilterState) => void;
  authenticated: boolean;
  onLoginRequired: () => void;
}) {
  const update = (key: keyof PersonalFilterState) => {
    if (!authenticated) {
      onLoginRequired();
      return;
    }
    onChange({
      mineReviews: key === "mineReviews" ? !mineReviews : mineReviews,
      wishlistedOnly: key === "wishlistedOnly" ? !wishlistedOnly : wishlistedOnly,
    });
  };

  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: "0.8rem", padding: "0.7rem 0.85rem", margin: 0, background: "var(--surface)", minWidth: 0 }}>
      <legend style={{ padding: "0 0.35rem", fontSize: "0.88rem", fontWeight: 700 }}>내 메뉴</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
        <button
          type="button"
          aria-pressed={mineReviews}
          onClick={() => update("mineReviews")}
          style={filterButton(mineReviews)}
        >
          내가 리뷰한 메뉴
        </button>
        <button
          type="button"
          aria-pressed={wishlistedOnly}
          onClick={() => update("wishlistedOnly")}
          style={filterButton(wishlistedOnly)}
        >
          찜한 메뉴
        </button>
      </div>
      {!authenticated ? <span style={{ display: "block", marginTop: "0.45rem", color: "var(--muted)", fontSize: "0.82rem" }}>로그인하면 개인 메뉴 필터를 사용할 수 있어요.</span> : null}
    </fieldset>
  );
}

function filterButton(active: boolean) {
  return {
    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
    borderRadius: "999px",
    background: active ? "var(--accent-soft)" : "var(--surface)",
    color: active ? "var(--ink)" : "var(--muted)",
    padding: "0.38rem 0.72rem",
    cursor: "pointer",
    fontWeight: active ? 700 : 500,
  } as const;
}
