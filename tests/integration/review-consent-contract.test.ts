import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const consentTokens = /non_event_review_consent|nonEventReviewConsent|nonEventConsent|이벤트 참여나 대가 없이 작성|비이벤트 동의/;

test("review forms and app contracts do not collect or send event consent", () => {
  for (const file of [
    "components/reviews/ReviewForm.tsx",
    "frontend/src/components/ReviewForm.tsx",
    "frontend/src/api/reviews.ts",
    "lib/data/reviews.ts",
    "backend/src/main/java/com/yumreview/review/Review.java",
    "backend/src/main/java/com/yumreview/review/ReviewDtos.java",
    "backend/src/main/java/com/yumreview/review/ReviewService.java",
    "scripts/migrate/export-spring-data.ts",
    "scripts/migrate/import-supabase.ts",
    "scripts/migrate/import-media.ts",
    "scripts/migrate/verify-media.ts",
    "scripts/migrate/verify-supabase-import.ts",
  ]) {
    assert.doesNotMatch(read(file), consentTokens, `${file} still references review event consent`);
  }
});

test("migration export format no longer accepts consent-bearing artifacts", () => {
  assert.match(read("scripts/migrate/export-spring-data.ts"), /yum-review\.spring-export\/v2/);
  assert.match(read("scripts/migrate/import-supabase.ts"), /yum-review\.spring-export\/v2/);
});

test("additive schema removes policy and client access dependence without dropping the column", () => {
  const migration = read("supabase/migrations/20260928120000_purge_journal_and_menu_media_attribution.sql");
  const policySection = migration.slice(
    migration.indexOf("CREATE POLICY reviews_self_insert"),
    migration.indexOf("REVOKE SELECT ON public.reviews"),
  );

  assert.doesNotMatch(policySection, /non_event_review_consent/i);
  assert.match(migration, /DROP POLICY IF EXISTS reviews_self_insert/);
  assert.match(migration, /DROP POLICY IF EXISTS reviews_self_update/);
  assert.match(migration, /REVOKE SELECT ON public\.reviews FROM anon, authenticated/);
  assert.doesNotMatch(migration, /DROP COLUMN\s+non_event_review_consent/i);
});
