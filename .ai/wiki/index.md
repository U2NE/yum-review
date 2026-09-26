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

Task 09 remains **PARTIAL**. The user explicitly directed a GitHub push and real Vercel deployment verification on 2026-09-27; that release work is proceeding after local checks. This does not complete product acceptance. The 57-case role/viewport matrix, guest and owner/server-admin flows, positive local Vault/HMAC image verification, missing-object PENDING release, original-file byte-claim proof, import/checksum reconciliation, and hosted Supabase/Auth/Storage gates remain unresolved and separate from Vercel automatic deploy. The `QA 사진 확인자` review is still present on menu 12; it was not deleted. Preserve the existing `QA 사진 작성자` review.


A 2026-09-26 residual Hybrid QA pass found only the authenticated Codex In-app Browser in the available CUA inventory; a second tab inherited the member session, so no guest browser flow was claimed. Cookie-free HTTP requests confirmed selected public routes return 200 and selected account/admin routes redirect to login. They did not verify rendered guest UI, control behavior, back/forward, search correctness, or responsive behavior. The selected member pointer checks and route checks are recorded as PARTIAL in the [UI QA matrix](../../docs/migration/ui-qa-matrix.md). The scoped run audit had 16 decisions, 2 events, 1 actor report, and zero findings.

Task 09 remains **PARTIAL**. The user directed a GitHub push and actual Vercel deployment verification on 2026-09-27; release work is proceeding after local checks. This does not complete acceptance. Full 57-case role/viewport coverage, guest and owner/server-admin UI flows, positive local Vault/HMAC image verification, missing-object PENDING release, source/target import/checksum reconciliation, and hosted Supabase/Auth/Storage gates remain unresolved and separate from Vercel automatic deploy. No review was deleted; preserve both QA reviews.

## Vercel release check — 2026-09-27

Commit `a9d513f9d850c9395ae586da07488fc11451b4d7` is on `origin/main`; GitHub reports Vercel Production deployment `6681498070` successful. The public alias [yum-review.vercel.app](https://yum-review.vercel.app) and its homepage, login, and signup pages render. The homepage reports menu loading failed and `/menus/12` reports menu detail loading failed. The deployment-specific URL redirects to Vercel login. The cause is unverified; no production forms, data, or settings were changed. Hosted Supabase/Auth/Storage and import/checksum status remains unverified, so Task 09 is still **PARTIAL**. The pre-push audit retains one `FILE_OWNERSHIP_MISMATCH`; the separate reconciliation run has no actor report, and its zero-finding result does not cover that missing worker self-report. See the [release audit](../../docs/migration/hybrid-run-audit.md).
