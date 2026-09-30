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
