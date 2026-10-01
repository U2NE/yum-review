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
