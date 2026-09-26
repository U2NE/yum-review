---
title: Project Wiki
category: index
tags: [index]
---
# Project Wiki

Derived knowledge projection. Canonical state is under `.planning/`.

## Local runtime

The live MVP was verified on 2026-09-25 with PostgreSQL in WSL Ubuntu. Flyway migrations, menu loading, signup/login, review create/update/delete, and menu rating aggregation succeeded. See [README](../../README.md) for Docker and WSL database setup and the API port override.

Manual browser QA on 2026-09-25 exercised search submission and both clear-search states, quick-search buttons, recommendation/rating sort, menu and restaurant links, public reviews while logged out, signup/login validation and redirects, review create/edit/cancel/delete, rating recalculation, and logout. Search clearing now resets the query URL as well as the visible results. Public menu reviews are accessible to guests and their timestamps map correctly from PostgreSQL. The price formatter is outside the React page module, avoiding a development Fast Refresh warning. The temporary UI-QA review and account were removed after deletion was verified; pre-existing data was preserved. Frontend production build passes.

## Next.js/Supabase continuation — 2026-09-26

The local Docker Engine 29.8.0 responds; existing Supabase core containers are healthy, and all 12 local migrations match. `npx tsc --noEmit` passes, `http://127.0.0.1:3001/` returns HTTP 200, and an isolated staging-copy `next build --webpack` passes with local placeholder values. This does not verify Turbopack or hosted deployment. Runtime details are in [local runtime verification](../../docs/migration/local-runtime-verification.md).

A Hybrid Browser Tester completed selected pointer QA for a member at 1265×720: home filter, menu detail, my-review search, favorite/unfavorite, other-user like/unlike, edit cancel, and 0.5 half-star select/deselect/restore. The Lead confirmed no document horizontal overflow on the home page at widths 360, 390, 768, and 1440. Test state was restored and no screenshots were saved. See the [UI QA matrix](../../docs/migration/ui-qa-matrix.md) for the evidence and limits.

Task 09 remains **PARTIAL**. Release status below supersedes older notes that said the user-directed push was still proceeding. This does not complete product acceptance. The 57-case role/viewport matrix, guest and owner/server-admin flows, positive local Vault/HMAC image verification, missing-object PENDING release, original-file byte-claim proof, import/checksum reconciliation, and hosted Supabase/Auth/Storage gates remain unresolved and separate from Vercel automatic deploy. The `QA 사진 확인자` review is still present on menu 12; it was not deleted. Preserve the existing `QA 사진 작성자` review.


A 2026-09-26 residual Hybrid QA pass found only the authenticated Codex In-app Browser in the available CUA inventory; a second tab inherited the member session, so no guest browser flow was claimed. Cookie-free HTTP requests confirmed selected public routes return 200 and selected account/admin routes redirect to login. They did not verify rendered guest UI, control behavior, back/forward, search correctness, or responsive behavior. The selected member pointer checks and route checks are recorded as PARTIAL in the [UI QA matrix](../../docs/migration/ui-qa-matrix.md). The scoped run audit had 16 decisions, 2 events, 1 actor report, and zero findings.

Historical snapshot: at the time this note was written, the user-directed push and Vercel verification were still proceeding. This was superseded by the 2026-09-27 release closeout below. Task 09 remains **PARTIAL**. Full 57-case role/viewport coverage, guest and owner/server-admin UI flows, positive local Vault/HMAC image verification, missing-object PENDING release, source/target import/checksum reconciliation, and hosted Supabase/Auth/Storage gates remain unresolved and separate from Vercel automatic deploy. No review was deleted; preserve both QA reviews.

## Vercel release check — 2026-09-27

Historical snapshot: commit `a9d513f9d850c9395ae586da07488fc11451b4d7` and deployment `6681498070` were the observed release at that point. This was superseded by the 2026-09-27 release closeout below. See the [release audit](../../docs/migration/hybrid-run-audit.md).

## Vercel release closeout — 2026-09-27

Commit `72c836be8546bf607d1edd614681553bf1148a97` is on `origin/main`; Vercel Production deployment `6681638995` succeeded at [the deployment URL](https://yum-review-lx0uyallh-suh6.vercel.app). The public alias [yum-review.vercel.app](https://yum-review.vercel.app) was re-opened after this deployment. The homepage still reports catalog loading failure and `/menus/12` still reports menu detail loading failure; `/login` and `/signup` render. The cause is unknown because the application broadly catches errors from environment/client/query operations; configuration failure must not be inferred. No production data or settings were touched. Hosted Supabase gates remain open and Task 09 remains **PARTIAL**.

The final closeout Hybrid audit has 16 decisions, 2 action events, and 2 actor reports, with zero findings from deterministic `auditDecisionTrace`. Both self-reports came from one Implementer; the current audit does not flag this report-count anomaly, so it remains a provenance limitation. Preserve the pre-push `FILE_OWNERSHIP_MISMATCH` and the reconciliation worker's missing self-report as historical provenance gaps.
