# Static code review

Review date: 2026-09-26  
Scope: independent, read-only re-review of the prior findings and the remediation plan, including `20260926180002_media_and_review_integrity.sql`, `lib/media/storage.ts`, `lib/data/catalog.ts`, `lib/data/media.ts`, and `scripts/migrate/import-supabase.ts`, with directly related policy, API, and importer code inspected for contract checks. No application source was changed and no tests were run as part of this review.

## Confirmed closed findings

### [P1] Stale Task07 media activation handoff — closed

[`scripts/migrate/import-supabase.ts:9`](../../scripts/migrate/import-supabase.ts) now describes the proof-bearing `activate_media_upload(uuid, text, text)` path for interactive uploads and explicitly says the retired one-argument RPC does not exist. It keeps legacy import on the separate local-only `scripts/migrate/import-media.ts` path. The verifier emits the same contract ([`scripts/migrate/verify-supabase-import.ts:133`](../../scripts/migrate/verify-supabase-import.ts)). Static inspection of the importer confirms it validates mapped user/media/target metadata, checks local object size and SHA-256, and activates plus associates validated media inside a guarded local transaction ([`scripts/migrate/import-media.ts:779-879`](../../scripts/migrate/import-media.ts)).

### [P2] Five-photo review cap — closed in the database

The append-only migration installs a trigger for review-photo inserts and link-changing updates. It locks the parent review row, counts the existing links, and rejects a write at five ([`supabase/migrations/20260926180002_media_and_review_integrity.sql:239-291`](../../supabase/migrations/20260926180002_media_and_review_integrity.sql)). Existing duplicate links remain idempotent. This no longer relies only on the upload UI; runtime concurrency behavior is outside this static review.

### [P2] Review author cannot hydrate an inactive menu — closed narrowly

The new `private.has_review_on_menu` helper is `SECURITY DEFINER`, has a fixed `search_path`, and returns true only for a signed-in author with a review on that menu. The authenticated-only SELECT policy uses that helper ([`supabase/migrations/20260926180002_media_and_review_integrity.sql:293-316`](../../supabase/migrations/20260926180002_media_and_review_integrity.sql)). Static inspection found no corresponding access for guests or unrelated users.

### [P2] Invalid media IDs contending on the shared decoder lock — closed in the SQL path

`consume_media_verification_attempt` checks caller ownership, `PENDING` status, and the permitted object path before taking any lock, then takes a per-user quota lock and repeats the check while locking the asset row ([`supabase/migrations/20260926180002_media_and_review_integrity.sql:1-49`](../../supabase/migrations/20260926180002_media_and_review_integrity.sql)). The shared decoder lock remains only in the service-role slot-claim function, after target authorization and Storage-object existence checks, with a recheck after lock acquisition ([same migration:95-197](../../supabase/migrations/20260926180002_media_and_review_integrity.sql)). Grants keep quota consumption authenticated-only and slot claiming service-only ([same migration:90-93,234-237](../../supabase/migrations/20260926180002_media_and_review_integrity.sql)).

### [P2] TUS Location could direct authenticated requests off-origin — closed in the inspected client

[`lib/media/storage.ts:44-90`](../../lib/media/storage.ts) builds the configured endpoint, enforces HTTPS outside local loopback, and validates returned upload locations against the expected origin and exact upload-session path before follow-up requests. Credentials, query strings, fragments, and malformed session paths fail closed. The POST, HEAD, and PATCH fetches use `redirect: "error"` ([same file:108-114,142-154,169-179](../../lib/media/storage.ts)), so the bearer token or image chunk is not forwarded through an automatic redirect. This is a static conclusion; no mocked TUS/browser network test was run in this review.

## Follow-up review — signed image refresh (2026-09-26)

### [P2] Expired signed image URL recovery — closed in source

`RefreshableImage` now handles an image request failure by requesting one fresh URL (via App Router refresh for menu images, or the existing authenticated preview query for public review images), then retries when `src` changes. It limits each source URL to one retry and leaves a readable fallback if renewal fails or does not arrive within ten seconds ([`components/media/RefreshableImage.tsx:36-48,58-91`](../../components/media/RefreshableImage.tsx); [`app/menus/[id]/page.tsx:51-57`](../../app/menus/%5Bid%5D/page.tsx); [`components/reviews/ReviewCard.tsx:56-64,172-185`](../../components/reviews/ReviewCard.tsx)). This closes the earlier long-lived-page expiry finding by source inspection. Browser/runtime confirmation is pending the separate QA report.

### [P2] Per-review 45-second photo polling scales with feed size — open

Every mounted non-own `ReviewCard` calls `getReviewPhotoPreviews` immediately and every 45 seconds, even when that review has no photos ([`components/reviews/ReviewCard.tsx:66-81`](../../components/reviews/ReviewCard.tsx)). Each call first queries `review_photos`; when photos exist it also queries `media_assets` and mints signed URLs ([`lib/data/media.ts:39-59,75-91`](../../lib/data/media.ts)). Thus request volume grows with the number of displayed non-own reviews, and the interval does not pause for hidden tabs or guard against a prior slow request still running. This creates avoidable recurring database/storage-signing work on long-lived or large feeds; the refresh-on-image-error callback already provides an event-driven renewal path. Static review only; request cost was not measured.

## Validation limits

This was source inspection only. I did not execute the new migration, race concurrent writes, call the media API, run an import artifact, build the app, exercise TUS or signed URLs in a browser, or measure polling traffic. Refer to the separate local-runtime, security, and UI-QA reports for those checks; static conclusions here do not substitute for them.

## Follow-up review — review-photo polling removal (2026-09-26)

### [P2] Per-review 45-second photo polling — closed in source

The current [`ReviewCard`](../../components/reviews/ReviewCard.tsx) has no interval or timer for periodic photo queries. A non-own review loads its previews on mount and when its review ID or own-review status changes; a failed image requests a fresh preview through `RefreshableImage`'s `onError` callback. The initial fetch still uses `createSupabaseBrowserClient()` and `getReviewPhotoPreviews`; the `review_photos` SELECT policy continues to permit `anon` and `authenticated` reads only for rows linked to an existing review ([`20260925130001_rls_and_role_helpers.sql:632-636`](../../supabase/migrations/20260925130001_rls_and_role_helpers.sql)). This removes the recurring per-card database/signing load identified above while retaining initial preview loading and event-driven URL renewal.

The in-flight request map is keyed by review ID and shares only the pending promise. Its `finally` handler deletes the map entry only if that same promise is still registered. Each card also checks a review-ID ref before applying either success or error state; effect cleanup clears the matching ID, so a late response from an old review or an unmounted card cannot overwrite that card's current state. Rejections are caught by the caller, while the cleanup chain has its own catch to avoid an unhandled rejected `finally` promise. The request itself is not aborted on unmount, but its result is ignored by the stale-card guard and its map entry is cleared on settlement.

`RefreshableImage` still permits one retry for a failed source URL, displays its fallback if renewal does not change the URL within ten seconds, and clears the timer on unmount. One interaction limits that fallback guarantee: `refreshPublicPhotoPreviews` converts errors to an empty list, and `ReviewCard` conditionally unmounts the image section when the list is empty. Also, `getReviewPhotoPreviews` returns an empty list for query or signed-URL errors. Therefore an empty/failed renewal can remove the image and its fallback before the ten-second bound; source inspection does not support the earlier unqualified claim that a readable fallback is always left visible. This is a separate fallback-state limitation from the now-closed polling finding.

Browser/runtime verification remains pending: confirm the initial preview under anonymous and authenticated RLS, one error-triggered renewal with no periodic requests, request deduplication across cards, stale-response behavior during review change/unmount/error, and the visible result when renewal returns no preview. No tests or runtime actions were performed in this follow-up.

## Follow-up review — review-photo scope and fallback (2026-09-26)

### [P2] In-flight preview request scope and stale-result protection — closed by source inspection

`loadReviewPhotoPreviews` coalesces only a pending request with the same review ID and current user ID; its `finally` cleanup removes the entry only if that exact promise is still registered. `refreshPublicPhotoPreviews` captures the same pair as a scope token before awaiting and commits results only while the card's current scope still matches. The effect depends on `current.id`, `isOwnReview`, and the callback; that callback in turn depends on `current.id`, `currentUserId`, and `isOwnReview`. Therefore a login/logout or account switch creates a new access-scoped request, while effect cleanup invalidates the previous scope so a late result cannot update the card. Own-review and guest transitions clear the public preview state. No interval or timer remains in `ReviewCard`; initial loading and image-error-triggered refresh are event driven. These conclusions are static only.

### [P2] Failed preview result can unmount the visible image fallback — remains open

Initial-load exceptions clear previews (`preserveOnError=false`), intentionally avoiding stale images but leaving no error or empty-state UI. During image-error refresh, thrown exceptions preserve the current preview list (`preserveOnError=true`), allowing `RefreshableImage` to keep its bounded fallback. However, `getReviewPhotoPreviews` converts query errors, missing data, and signed-URL failures to `[]` rather than rejecting. That successful empty result is applied in both paths; on refresh, it makes `publicPhotoPreviews?.length` false and unmounts the image and its fallback immediately. Source inspection therefore does not support a reliable visible fallback when renewal cannot produce a preview. Consider returning a result that distinguishes a legitimate no-photo state from a fetch/signing failure, and render an explicit error state for failures.

### Runtime verification status

No tests or browser actions were performed in this follow-up, as assigned. The existing [`signed-url-refresh-verification.md`](signed-url-refresh-verification.md) predates this scope/fallback change and records behavior from the 45-second polling implementation; it does not verify current request coalescing, account-switch cleanup, no recurring requests, or this empty-result fallback path. Fresh runtime verification of this revision remains pending.

## Follow-up review — failed review-photo slot preservation (revision 8, 2026-09-26)

Scope: static, read-only review of `components/reviews/ReviewCard.tsx` and the related preview-loading contract in `lib/data/media.ts`. No source was changed and no tests or browser actions were run.

### Behaviors confirmed by source inspection

- The pending-request map is scoped by both review ID and current user ID. Concurrent image failures for the same pending request add their media IDs to one shared set; the shared response is applied once per card through a `WeakSet`.
- On a successful refresh, returned previews replace old URLs. Only omitted IDs that were explicitly reported as failed are retained from the previous state, so a query returning `[]` or a partial result keeps failed-image fallback slots while dropping omitted, non-failed images. The helper's normal ordering is retained, with failed slots reinserted near their prior neighbors.
- A rejected refresh keeps only prior failed-image IDs. Initial load failures and empty results clear the preview list. A scope ref prevents results from an old review/user request from committing after the effect has switched scope or cleaned up. Own-review and guest states clear the public preview state.
- `ReviewCard` has no recurring photo polling. Its image component retains the bounded ten-second failure fallback timer. This finding is limited to public review cards; `ImageUpload` has a separate refresh path and is outside this source review.

### Open findings

#### [P2] Preview state is not tagged with the identity scope used to load it

The async commit guard uses `photoRefreshScope`, but `publicPhotoPreviews` stores only the array and the render reads that array immediately. When `currentUserId` or the review scope changes, the new render can still expose previews from the previous scope until the passive effect runs and clears the state. The old request is rejected after cleanup, so this is not an observed new authorization bypass; it is a transient stale-render window and means the state itself is not strictly scope-isolated. Store the scope with the preview state and render only when it matches the current review/user, or reset the card by a scope key.

#### [P2] Initial preview failures are silently indistinguishable from a review with no photos

`getReviewPhotoPreviews` maps query errors, missing rows, and signing failures to `[]`. On initial load, `refreshPublicPhotoPreviews` stores that empty list and the conditional section renders nothing. There is no user-visible error or retry affordance for this initial failure, so a temporary RLS/network/signing problem looks like a review without photos. The failed-slot preservation repair covers error-triggered renewal only after an image was already mounted; it cannot preserve or describe an initial failure.

### Validation limits

These are static conclusions. The same-user in-flight merge and stale scope transitions still need runtime confirmation. The helper does not expose whether an empty list means “no linked photos” or “query/signing failed,” so a source-level distinction requires changing that result contract or adding a separate error signal.

## Follow-up review — render-time review-photo scope isolation (revision 9, 2026-09-26)

Scope: read-only review of `components/reviews/ReviewCard.tsx` for the requested review/viewer render scope, failed-slot merge, and polling behavior. No source changes or tests were performed.

### Confirmed closed by source inspection

- The preview state stores both the preview array and a `scopeKey` made from the review ID and current viewer ID. During render, the component exposes previews only if the stored key matches the current props. If the review or viewer changes, the old signed URLs are hidden in that very render; this does not depend on the passive effect running first.
- Requests are coalesced by review ID plus viewer ID. The completion guard also compares that pair to the active scope, and effect cleanup invalidates the old scope. Thus an old request cannot reintroduce the prior account's previews after a scope transition.
- A successful response replaces valid URLs and retains only previously displayed media IDs explicitly marked as failed when they are absent from the refreshed result. Omitted non-failed photos are dropped. Concurrent failed media IDs on a shared in-flight request are accumulated in its set before the response is applied. Rejected refreshes retain only failed slots; an initial rejected request clears the list.
- `ReviewCard` contains no interval or timer for periodic photo refresh. Loading is triggered on mount/scope change, and renewal is triggered by an image load error. This review is limited to public review-card previews; the distinct timer in the image-upload panel is outside this file's scope.

### Open limitation

#### [P2] Initial preview query/signing failures remain silent

`getReviewPhotoPreviews` still returns an empty array for query, missing-row, and signing failures. The initial-load path stores that empty result, and the image section then renders nothing, making a temporary failure indistinguishable from a review with no photos. Failed-slot preservation only helps after an image was already mounted; it does not describe or retry an initial failure. Fixing this needs a result contract that distinguishes “no photos” from “preview load failed,” plus a visible error/retry state. This remains an open user-facing limitation; no access-control bypass was found in this review.

### Validation limits

These findings are static only. Account-switch render timing, late request completion, and failed-slot behavior still need the separate local browser QA evidence; this source review does not claim runtime confirmation.
