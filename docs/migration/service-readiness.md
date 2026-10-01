# Service readiness — G8 hosted release

**Status: BLOCKED.** The approved Supabase migration apply failed before the first pending version was recorded. No production deployment or final purge followed.

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Hosted database schema | BLOCKED | The official CLI dry-run listed exactly four pending additive versions (20260928115000 through 20260928140000). Tracked apply returned `DbPushApplyError`, SQLSTATE `P0001`; history remained at 20260927120000. Read-only evidence indicates the PostgreSQL 17 role-creation guard likely rejects the creator's automatic membership. Repair that migration within an authorized scope, then repeat the bounded apply. |
| Restaurant/menu catalog and MENU Storage | PASS for the bounded failed apply | Same-process keyed before/after comparison matched. Exact `storage.objects` MENU path set matched the 40 metadata paths. Counts: 3 restaurants, 72 menus, 40 MENU objects, 11,576,811 bytes; Gompocha: 1 restaurant, 40 menus, 40 objects. |
| Supabase Auth password policy | NOT VERIFIED | No hosted Auth configuration was changed or confirmed during this blocked release. |
| Supabase Site URL | USER-CONFIRMED, NOT RECHECKED | The user previously confirmed the Site URL is set. Callback configuration was not independently verified in this attempt. |
| Email sender and SMTP | BLOCKED / NOT VERIFIED | No delivery or confirmation-email test was run. Free-tier template branding remains unavailable under the G8 plan. |
| Supabase Storage and TUS behavior | NOT VERIFIED | Reading the MENU objects proves byte availability only. No upload principal, TUS create/chunk/finalize, drain, or purge-boundary probe was run. |
| Vercel production release | NOT RUN | No main push or deployment occurred. Exact deployment, callback origin, guest/Auth/Storage smoke, and production health are not verified by this task. Earlier guest-only browser results remain historical evidence. |
| VWorld consent and storage permission | BLOCKED / NOT RECHECKED | The G8 release attempt did not test provider terms or storage permission. Do not claim compliance or readiness without the required evidence. |
| Legacy schema and data | BLOCKED | Separate legacy deployment, Flyway consent drop, and legacy account/review reconciliation remain outstanding. See [legacy release verification](legacy-release-verification.md). |
| Role/viewport QA | NOT RUN for this release | The G8 plan requires 394 concrete role/viewport executions. No new deployment was available to test; prior rows retain their recorded status. |
| Account/review purge | NOT STARTED | No account or review data was deleted. Supabase freeze, Storage principal/TUS proof, and the separately verified legacy purge remain required. |

This document records release readiness, not completion of the broader G8 plan. Do not call the service fully ready until all blocked provider, deployment, QA, and legacy gates have evidence.

## G9 update — 2026-10-01

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Hosted database schema | PASS | The tracked CLI apply recorded all four approved migrations through `20260928140000`; history has 18 versions. The exact three PG17 membership rows and restricted role attributes match the approved shape; guard-owner `CREATE` is absent from `private` and `public`; the write freeze remains inactive. |
| Restaurant/menu and MENU preservation | BLOCKED | Post-apply counts remain 3/72/40, MENU byte total remains 11,576,811, Gompocha remains 1/40/40, and the exact Storage path set matches metadata. The apply wrapper's same-process keyed manifest compare failed after the two restaurant consent columns were added. Its process-only key and earlier snapshot were not persisted, so exact historical same-key reconciliation is unavailable. |
| Supabase Auth password policy and Site URL | NOT VERIFIED | No hosted Auth setting was changed or rechecked during G9. |
| Sender and SMTP | BLOCKED / NOT VERIFIED | No delivery test or sender change was performed. Built-in SMTP limits still prevent a production deliverability claim. |
| Vercel production release | NOT RUN | No push, deployment, callback check, or production smoke occurred. |
| Legacy schema/data and consent drops | BLOCKED | No legacy operation was attempted. See [legacy release verification](legacy-release-verification.md). |
| Role/viewport QA | NOT RUN for G9 | No new browser QA was performed. The matrix remains partial. |
| Account/review purge | NOT STARTED | No account or review data was deleted; Auth, Storage-principal, TUS, and legacy proofs remain required. |

The hosted schema is applied, but release readiness remains **BLOCKED**. G10 records the G9 historical keyed preservation comparison as permanently unavailable; prospective comparisons cannot replace that evidence or authorize purge. The updated manifest wrapper excludes only the two consent columns introduced by G9 for future cross-schema comparisons.

## G10 update — 2026-10-01

| Area | Status | Evidence / remaining gate |
|---|---|---|
| G9 historical catalog/MENU-byte preservation | NOT PROVEN; permanent evidence gap | The pre-apply key and snapshot were process-only and discarded. G10's narrower evidence cannot prove byte identity across the G9 schema apply and cannot authorize purge. |
| Applied migration DML review | PASS for static migration-time scope review | The four applied files contain no executed migration-time DML against restaurants, menus, MENU media metadata, or MENU Storage. Matching updates are enclosed in callable purge/location routines rather than run during migration installation. |
| Current catalog inventory | Reconciled, not historical proof | 3 restaurants, 72 menus, 40 MENU objects, 11,576,811 bytes; Gompocha 1/40/40. A fresh baseline and complete reads are still required around a future release. |
| Prospective root release gate | IMPLEMENTED; NOT RUN | One-process keyed wrapper performs read-only DB preconditions, awaits caller release work, verifies Vercel production SHA/HTTP, then compares the full catalog/MENU-byte baseline. No main push occurred. |
| Hosted Auth URL and password configuration | BLOCKED | Read-only Management API result: production Site URL; no explicit production callback entry and no localhost redirect entry; minimum length 6; `password_required_characters` is null. No settings changed. Apply the documented narrow PATCH to add the production callback and enforce length 8 plus English letters/digits, then read back. |
| Legacy release, role/viewport QA, and purge | BLOCKED / NOT RUN | G10 does not release legacy, change consent columns, create accounts, or delete personal data. Separate proof gates remain. |

The prospective root gate does not imply overall service readiness and must not be reused as evidence for the missing G9 historical comparison or as purge authorization.

## G10 postdeploy update — 2026-10-01

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Root production deployment | PASS for bounded guest checks | Deployed Next commit `81c573a`; root and `/menus/2` returned HTTP 200. The menu page showed the review heading and guest prompt. No authenticated review-create smoke ran; this is not the full role/viewport matrix. |
| Hosted Auth settings | PASS for post-PATCH readback | The authorized settings update was read back successfully: production Site URL and callback, minimum password length 8, and letters-plus-digits requirement. The older G10 preflight row above is historical pre-update evidence. |
| G10 catalog/MENU apply-window preservation | NOT PROVEN | The fresh complete baseline had 40 objects and 11,576,811 bytes, with Gompocha at 1/40/40, but same-process BEFORE/AFTER APPLY keyed output was lost. Current inventory is not historical equality proof. |
| G9 historical catalog/MENU-byte preservation | NOT PROVEN; permanent evidence gap | G9's process-only key and snapshot are unavailable. G10 cannot replace that proof or authorize purge. |
| Hosted consent-column drop | APPLIED ONCE | The initial no-linked-ref dry-run failed; the official CLI passwordless `--db-url` dry-run then passed with `20260928150000` as the exact sole pending migration. It was applied once; remote history has 19 versions, `20260928150000` latest, and `public.reviews.non_event_review_consent` absent. |
| Legacy Flyway V9 consent drop | NOT APPLIED | Legacy deployment health and exact live Flyway baseline remain unverified. |
| Full-chain pgTAP consent test | FOLLOW-UP REQUIRED | A stale test still expects the dropped consent column. Update the test in a follow-up; it was not changed here. |
| Role/viewport QA and purge | BLOCKED / NOT COMPLETE | Full matrix, hosted Auth/Storage/TUS purge proofs, and separate legacy reconciliation remain required. No account or review data was deleted. |

The hosted migration removed the retired review-consent column. G10's same-process apply-window catalog equality remains unproven, and G9 retains its permanent historical evidence gap. Role/viewport QA, legacy migration verification, and purge gates remain incomplete; no account or review data was deleted.

## G11 postdeploy follow-up — 2026-10-01

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Hosted consent-column migration | APPLIED ONCE | `20260928150000_review_consent_drop.sql` is applied once; history has 19 versions and `20260928150000` is latest. `public.reviews.non_event_review_consent` is absent. |
| Full-chain pgTAP catalog guard | UPDATED | Asserts the retired column is absent and retains the purge-journal privilege, uploader nullability, policy-dependency, MENU path, and menu-photo association guards. Plan count is seven. |
| Catalog/MENU baseline | PASS for fresh baseline only | Read 40 MENU objects / 11,576,811 bytes; Gompocha 1/40/40; path set matched metadata. G10 apply-window keyed proof was lost; this is not historical equality proof. G9 remains a permanent evidence gap. |
| Vercel production smoke | PASS for bounded guest route | Deployment `9968180` reported READY and `/menus/2` returned HTTP 200. No authenticated create QA was run. |
| Location search | BLOCKED | Production endpoint returned 503 because required Upstash production variables are missing. |
| Email | NOT VERIFIED | Generic built-in mail status only; no production sender/delivery proof. |
| Hosted/legacy data | PARTIAL / UNAVAILABLE | Read-only inventory is four users, one wishlist, zero reviews, and zero review-media. Legacy V9 and legacy database state are unavailable/unverified. |
| 394-case role/viewport matrix | BLOCKED | The complete matrix has not run. |
| Account/review purge | BLOCKED; NOT RUN — required Auth/DB/Storage/TUS and zero-row gates incomplete | No purge was performed. |

## G11 location quota implementation — 2026-10-01

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Shared location quota code | IMPLEMENTED; NOT HOSTED | Both root address lookup and reverse-geocoding routes use the same server-only Supabase RPC. It enforces an atomic limit of 20 requests per validated Vercel `x-real-ip` hash per minute. Missing/invalid production IP and Supabase/RPC failure fail closed; localhost is used only outside production. |
| Location quota migration | APPLIED; CONFIRMED IN G12 | G12 confirmed migration `20260928155000` exists in remote history and reported `dryRunUpToDate: true`. G13 adds no database migration and did not apply one; this state was not freshly rechecked in G13. The migration creates a private hash-only bucket table and service-role-only `SECURITY DEFINER` RPC. Table access is revoked including `service_role`; execution is revoked from public, anon, authenticated, and service_role before granting only to service_role. |
| Focused quota tests | PASS | `npx tsx --test tests/integration/location-rate-limit.test.ts` passed all five tests for IP validation, hashing/no raw IP transfer, success, limited, unavailable, and non-production localhost handling. `npx tsc --noEmit` and `git diff --check` also passed. |
| Production VWorld lookup | NOT VERIFIED | Deploy only through the approved release flow, then verify address search and reverse lookup on production. No migration apply, live-service call, or deployment was performed for this implementation. |

Release readiness remains **BLOCKED**. The fresh baseline, bounded guest smoke, and applied hosted migration do not close the G9/G10 historical preservation gaps, full QA, legacy verification, or purge prerequisites.

## G12 VWorld Referer repair — 2026-10-02

| Area | Status | Evidence / remaining gate |
|---|---|---|
| VWorld request Referer | IMPLEMENTED; NOT HOSTED | Forward and reverse calls derive the Referer exclusively from a validated HTTPS `NEXT_PUBLIC_SITE_URL` origin. Invalid values omit the header; request-controlled Origin/Referer and deployment hostnames are not used. |
| Provider diagnostics | IMPLEMENTED; NOT LIVE-VERIFIED | Server diagnostics contain only a fixed failure category and, for HTTP/JSON responses, a numeric status. Public messages remain generic. No key, provider URL, address, coordinates, provider body, or exception message is logged. |
| Production VWorld lookup | BLOCKED pending live verification | The user-confirmed canonical URL is `https://yum-review.vercel.app`; the Production secret was updated, but the READY deployment still failed. Recheck hosted forward and reverse calls after deploying this repair. If either still fails, retain sanitized category/status evidence and keep location QA BLOCKED. As of G12, no provider or deployment-region change was justified by the available evidence. G13 now runs the approved, bounded `icn1` region trial for the two location functions. |

## G13 location function region — VERIFIED — 2026-10-02

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Location quota migration state | CARRIED FORWARD FROM G12; NOT RECHECKED IN G13 | G12 confirmed migration `20260928155000` exists in remote history and `dryRunUpToDate: true`. G13 adds no database migration and did not apply one. No fresh G13 dry run was run; this row records only the G12 result. |
| Vercel function placement | PASS for bounded production checks | Production deployment on `main` at `3e51787000c325b29697305bbe13a4fcb193ab66` reported Ready. Both location function responses had an `x-vercel-id` region hint of `icn1`, matching the scoped `vercel.json` configuration. No project-wide/default region or other function was configured. |
| Existing location route protections | PRESERVED; PRIVATE NO-STORE CONFIRMED | Both handlers retain the existing Node.js runtime, shared quota enforcement, same-origin reverse-request check, 512-byte reverse body limit, private no-store responses, and sanitized public error behavior. Both bounded production responses were private/no-store. |
| Production VWorld lookup | PASS for bounded G13 checks | Fresh safe production forward and reverse checks both returned HTTP 200 with `configured=true` and `success=true`. Forward search returned one result; reverse lookup returned an address (value omitted). Durations were 2,667 ms forward and 714 ms reverse. These checks verify the two deployed location conversions; they do not close the broader role/viewport matrix. |

G13's bounded location deployment checks passed. Overall service readiness remains **BLOCKED** by the outstanding historical catalog-preservation evidence gap, full role/viewport QA, legacy verification, and account/review purge prerequisites. The migration state above remains carried forward from G12; no database change, migration apply, or fresh G13 dry run occurred.
