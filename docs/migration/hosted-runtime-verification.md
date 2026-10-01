# Hosted runtime verification

## 2026-09-27 read-only public browser pass

Target: [https://yum-review.vercel.app/](https://yum-review.vercel.app/)

Method: direct browser interaction through CUA in the Codex In-app Browser. The browser inventory exposed the hosted tab and the page accessibility tree. No explicit viewport dimensions were available. Results apply only to the guest session and observed viewport.

### Observed results

- The home page rendered `72 등록 메뉴` and `72 개 메뉴` and showed guest login/signup links.
- Searching `곰라면` and applying the filter produced one visible result, 곰포차 죽전점 곰라면 at 3,900원, with the URL query `q=곰라면`.
- Selecting Korean cuisine and applying added `category=KOREAN`; the combined search/category result count was zero. Selecting 죽전 added `region=죽전`.
- Selecting `맛 평점순` added `sort=taste`. Selecting `1km` added `radius=1000`. These control and URL transitions were observed, but rank/distance semantics were not established because the combined active filters returned no results.
- `필터 초기화` restored `/`, blank search, and default selector values.
- Clicking `장소 찾기` with an empty field displayed `장소 이름이나 주소를 입력해 주세요.` No external place lookup was submitted.
- `/menus/2` rendered 곰라면, 3,900원, four unreviewed rating values, and zero reviews. The review CTA routed a guest to `/login?next=%2Fmenus%2F2`.
- The restaurant link opened `/restaurants/1`, showing 곰포차 죽전점, 죽전, and its menu list.
- Clicking the home personal-review filter as a guest routed to `/login?next=%2F`.
- Submitting the login and signup forms empty showed browser-required-field feedback `이 입력란을 작성하세요.` No account was created.

### Scope and limits

This pass was strictly read-only. No sign-in, account creation, review, like, favorite, upload, mutating request, hosted setting change, or hosted database write was performed. Hosted data was not edited.

The following remain unverified: authenticated member, owner and server-admin flows; review and favorite mutations; successful media upload; successful Naver place lookup; ranking across non-empty multi-menu results; exact viewport/responsive coverage; and any write-path server errors. The full UI QA matrix and Task 09 therefore remain PARTIAL. Detailed per-control evidence is in [ui-qa-matrix.md](ui-qa-matrix.md).

## 2026-09-28 production deployment and guest filter pass

Target: [https://yum-review.vercel.app/](https://yum-review.vercel.app/), production deployment for commit `879d1968933e15e754d6c70e90e0363fa865506`. GitHub reported the Vercel check successful at 2026-09-28 02:48 UTC. The guest home and menu detail were also observed read-only by the Lead. This pass used a separate background CUA tab and did not disturb other tabs.

### Observed results

- Search for `곰라면` followed by `필터 적용` updated the URL to `?q=곰라면` and returned exactly one result: 곰포차 죽전점 곰라면, 3,900원.
- The cuisine and sort controls accepted 카페·디저트 and 리뷰 많은 순. Applying them updated the URL to `?category=CAFE&sort=reviewCount` and showed six 카페 menus. All six currently show zero reviews, so this did not establish ranking behavior for tied or non-empty review counts.
- Applying 주점 + 죽전 + 1km + 맛 평점순 updated the URL with `category=PUB`, `region=죽전`, `radius=1000`, and `sort=taste`. The UI showed zero matching menus and noted that 40 menus without location data were excluded from radius calculation. This combined result does not isolate which filter caused the empty result; distance and ranking semantics remain unverified.
- `필터 초기화` returned to `/` and restored the full 72-menu catalog.
- Opening 아메리카노 navigated to `/menus/41`, where the menu detail, restaurant link, unreviewed rating summary, and guest review-login link rendered. Browser back returned to the filtered six-menu catalog.

### Scope and limits

This was a guest-only, read-only production pass. No sign-in, review, like, favorite, upload, form submission, hosted setting change, or database write occurred. Search, cuisine, region, sorting, radius, apply/reset, menu detail, and back navigation were exercised. Authenticated member/owner/server-admin paths, write flows, media upload/removal behavior, ranking with non-empty data, successful place lookup, full viewport coverage, and the remaining Task 09 acceptance gates were not verified. Task 09 remains PARTIAL.

## 2026-10-01 G8 hosted schema release attempt — BLOCKED

### Read-only preflight

- Connected through the approved regional pooler using the supplied CA and process-only DPAPI credentials. The keyed in-memory snapshot read every restaurant/menu row and all 40 MENU objects in the approved Storage bucket; `storage.objects` path set exactly matched the 40 MENU metadata paths.
- Counts were 3 restaurants, 72 menus, and 40 MENU objects (11,576,811 bytes total). Gompocha associations were 1 restaurant, 40 menus, and 40 MENU objects. No key, raw object path, image byte, email, or account UUID was persisted.
- Supabase CLI 2.118.0 dry-run listed exactly the four expected additive migrations: 20260928115000, 20260928120000, 20260928130000, and 20260928140000. No seed or role work was listed.
- Targeted catalog-manifest and migration-gate tests passed (11 tests).

### Tracked apply result

- The fourth bounded apply was invoked through the official tracked Supabase CLI with `--skip-vault`, process-only credentials, `lock_timeout=5s`, and `statement_timeout=120s`. It failed with sanitized CLI error code `DbPushApplyError` and SQLSTATE `P0001`. Migration history remained at 20260927120000 (14 versions total); none of the four target versions is recorded as applied. The retained CLI evidence does not identify a precise migration statement.
- The same-process keyed post-operation check completed and matched the complete catalog and Storage-byte baseline. The 3/72/40 counts, 11,576,811 bytes, and Gompocha 1/40/40 association counts were unchanged.
- Read-only precondition diagnosis found PostgreSQL major version 17, a non-superuser CREATEROLE connection, neither purge role present after rollback, and zero current role-attribute, role-membership, MENU path, or MENU association violations. The first migration creates the restricted purge roles and then rejects any membership edge involving them in the same transaction. PostgreSQL 16+ automatically grants the creating CREATEROLE role ADMIN OPTION membership in a newly created role; this is the likely cause of the migration's own P0001 role-membership guard. Exact CLI message text was not retained, so treat this as a diagnosed likely cause rather than an exact server-message record.

No Auth password-policy change, hosted Site URL change, main push, Vercel deployment, consent-column drop, legacy migration, or account/review purge was performed. No zero-downtime or hosted Auth/Storage/TUS readiness claim is made. The release remains **BLOCKED** until the migration's PostgreSQL 17 role-creation guard is repaired through its authorized migration scope and a fresh keyed baseline/apply verification succeeds.

## 2026-10-01 G9 hosted schema release — APPLY RECORDED, PRESERVATION RECONCILIATION BLOCKED

- The exact `yum-review` project in `ap-south-1` was confirmed through the Supabase Management API. The hosted database reported PostgreSQL 17. The official CLI dry-run listed exactly the four approved additive migrations and no seed or role work.
- The tracked CLI apply recorded versions `20260928115000`, `20260928120000`, `20260928130000`, and `20260928140000`; migration history now contains 18 versions and ends at `20260928140000`.
- Read-only post-apply checks found the exact three approved PostgreSQL 17 membership rows, the restricted role attributes, zero residual `CREATE` on `private` and `public` for `purge_guard_owner`, and an inactive freeze (`active_run_id` and `frozen_at` are null).
- The apply wrapper's same-process manifest comparison failed because its restaurant-row hash included the two newly added `location_consent_version` and `location_consent_at` columns. The wrapper did not report which digest differed. The hosted counts remain 3 restaurants, 72 menus, and 40 MENU objects (11,576,811 bytes); Gompocha remains 1 restaurant, 40 menus, and 40 MENU objects. The Storage object path set still matches the MENU metadata paths.
- The process-scoped key and pre-apply snapshot were intentionally not persisted. After process exit, the exact historical same-key before/after digest comparison cannot be reconstructed. Therefore the counts, byte total and path-set reconciliation are recorded, but the complete keyed row-and-object preservation proof is **BLOCKED**. The wrapper now strips only those two G9-added restaurant columns for future cross-schema comparisons; this prospective correction does not repair the missing historical proof.

No hosted password-policy or redirect setting was changed, and no main push, Vercel deployment, consent drop, legacy migration, or purge was performed. Continue to hold release readiness until the preservation gap is reconciled and the remaining deployment gates are completed.

## 2026-10-01 G10 prospective hosted release gate

G10 does not repair or replace the missing G9 same-key pre/post comparison. That historical comparison is permanently unavailable because its process-only key and snapshot were discarded. G9 is not represented as byte-for-byte proven.

The four applied SQL files were reviewed for migration-time restaurant, menu, MENU metadata, and `storage.objects` DML. They install tables, constraints, functions, triggers, policies, and privileges; the `UPDATE public.media_assets` matches are statements inside purge functions and do not execute during migration installation. The restaurant-location update is likewise inside the later callable server RPC. No migration-time statement changed restaurant/menu rows, MENU metadata, or MENU Storage objects. This static scope review does not prove the prior G9 bytes.

Prospective release gate: after guard completion and commit, use only the guarded `--push-and-verify-release` CLI. The CLI checks both resolved `origin` fetch and push URLs against the approved GitHub `U2NE/yum-review` repository before it fetches or pushes; checks read-only migration history, PostgreSQL 17 role attributes/membership/schema grants, and the inactive freeze; captures a fresh keyed baseline including all current restaurant columns with complete MENU bytes; pushes the pinned full commit and verifies Vercel's ready production deployment reports that exact SHA and the production origin returns HTTP 200; then reads and compares the complete catalog under that same key. Any read, remote, commit, health, or comparison failure prevents a PASS. The key, object paths, and bytes remain in memory only. This prospective gate covers only the future push/deploy window; it must not authorize purge or imply G9 historical preservation proof. The generic callback wrapper is private to the script and is not an external release interface.

The read-only G10 Management API preflight confirmed the production Site URL, no explicit production callback entry in the redirect allowlist, no localhost entry, minimum password length 6, and a null `password_required_characters`; the complete redirect list was not emitted. The read-only database preflight confirmed history has 18 versions ending at `20260928140000`, PostgreSQL major 17, the expected three role membership edges, restricted role attributes, no `CREATE` for `purge_guard_owner` on `private`/`public`, and one inactive freeze row. It freshly read 3 restaurants, 72 menus, 40 MENU objects totaling 11,576,811 bytes, with Gompocha at 1/40/40. Vercel reported READY production commit `d94a0e974bcab52d9e31d938a9be6d634831515f`. These results are point-in-time read-only checks, not evidence that a new release occurred.

These Auth settings were not changed. After an independently authorized settings action, preserve the production Site URL while setting `site_url` to `https://yum-review.vercel.app`, `uri_allow_list` to include `https://yum-review.vercel.app/auth/callback` (merge with any already-approved entries without emitting the list), `password_min_length` to `8`, and `password_required_characters` to `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789`. Supabase Management API exposes these keys on `PATCH /v1/projects/{ref}/config/auth`; read before, patch only these fields, and read after to verify. The API documents these config fields and character-set value; see [Supabase Auth config API](https://supabase.com/docs/reference/api/v1-update-auth-service-config) and [password security](https://supabase.com/docs/guides/auth/password-security). No update was sent by G10. Legacy schema/data, consent drops, role QA, and personal-data purge remain separate blocked gates.
