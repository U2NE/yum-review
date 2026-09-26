# Hybrid Agent Framework run audit

Run: `yum-review-task09-resume-20260926`  
Scope: resume the review-photo refresh fix, review it, run sanitized build checks, and resume local UI QA.

## Revision 9 work

- The implementer tagged preview state with its review and viewer scope so a render for a different account hides the prior viewer's signed URL immediately.
- Independent code and security reviews completed. Both describe the initial photo query/signing error behavior as a remaining availability limitation; the security review found no new RLS bypass in this patch.
- A tester ran `npx tsc --noEmit` and a fresh `npm run build` with process-only loopback/dummy configuration. Both passed. No hosted endpoint or credential was used.
- The lead resumed browser QA against local Next.js on port 3001. Guest filters, unauthenticated route redirects, required signup fields, missing Naver key handling, and location timeout were observed. Full authenticated flows were blocked because Docker could not make the local Supabase engine ready.
- An independent verifier decision was prepared by the framework but its actor was not dispatched. Do not treat this run as full acceptance.

## Provenance audit

The full run contains 251 decisions, 60 orchestration events, and 26 actor reports. `auditDecisionTrace` reports 15 findings: 11 missing expected actions from earlier prepared or interrupted tasks, one decision/action mismatch, one file-scope mismatch, one missing decision, and one role mismatch. These findings are retained in the Hybrid runtime audit artifact; they are not hidden by the revision-specific review.

The executed revision-9 scope follows its parent decisions and contains seven decisions, nine events, and four actor reports. It reports one file-scope mismatch: the code-review actor lists both the inspected `ReviewCard` source and its review document, while its dispatch decision listed only the review document. The source listing describes inspection in the actor report; the reviewer did not modify the source.

## Remaining work

1. Restore local Docker engine readiness without resetting its data.
2. Complete authenticated guest/member/owner/server-admin UI and API checks, including review image refresh, review likes, favorites, menu administration, and aggregate updates.
3. Dispatch the prepared independent verifier after runtime QA evidence exists, then resolve or explicitly retain the audit findings before publication.

## 2026-09-26 local-runtime recovery and authenticated continuation

The three remaining-work statements above describe the earlier snapshot and are now superseded for local environment availability: Docker is running, the current local Supabase core containers are up with configured health checks passing, the existing 12-migration database was not reset, and a sanitized request to the Next.js app on port 3001 returned HTTP 200. A fresh TypeScript check also exited 0. See [local runtime verification](local-runtime-verification.md) and the appended [authenticated UI observations](ui-qa-matrix.md#2026-09-26-인증-사용자-브라우저-연속-qa).

The lead exercised a member session using the in-app browser's accessibility/keyboard path. This covered selected search/filter/reset and sort URL changes, menu and restaurant navigation, member-only filter toggles, profile-name save/restore, half-star and clear behavior, consent and required overall-score validation, review create/edit/aggregate recalculation, edit cancellation, other-user like/unlike, favorite/unfavorite, protected-route redirects, blank password-form validation, and the image fallback. It did **not** cover pointer clicks, all 57 role/viewport cases, owner/server-admin success flows, logout/password change, or the positive current Vault/HMAC image route. The QA-created review remains at menu 12 because its exact deletion is awaiting action-time user confirmation; the pre-existing QA review remains intact.

The comment-limit code review found that native textarea `maxLength` counts UTF-16 units, while the controlled code-point counter and validation allow 1,000 Unicode code points. The implementer kept `maxLength={2000}` and the existing 1,000-code-point clamp, adding a comment to explain the distinction. `npx tsc --noEmit` passed. Runtime input verification covered 1,100 ASCII characters; 1,000 supplementary Unicode characters were not separately exercised.

The installed audit was re-run over the full resumed runtime and saved through the Lead provenance session to its `audit.json`: 281 decisions, 78 action events, and 35 actor reports produced 20 findings (1 decision/action mismatch, 4 file-ownership mismatches, 3 missing decision links, 11 missing expected actions, 1 role-ownership mismatch). The selected current-task slice has 9 decisions, 18 events, and 9 actor reports with 10 findings (2 file-ownership mismatches and 8 missing decision links). These are preserved provenance gaps across earlier interrupted/resumed tasks and self-reports that lack linked decision IDs; they are not treated as a clean audit. A scoped report was also written as `audit-task09-current.json`.

To reconcile the latest authenticated QA documentation and live local status, a separate read-only Hybrid verifier run (`yum-review-final-evidence-20260926`) reviewed the current `ReviewForm`, state, UI matrix, runtime record, and derived wiki. It confirmed the local app response, running local containers, the UTF-16/code-point distinction, and that the missing UI, owner/admin, and positive Vault/HMAC cases must remain partial/not run. Its run audit has 16 decisions, 2 linked actions, 1 actor report, and **0 findings**; the derived result is saved as `audit.json` in that run. This clean scoped review does not erase the earlier full-run findings or certify the whole Task 09 matrix.

Historical snapshot: at the time this note was written, Task 10 push was not performed and the prior Vercel success applied to `d135989`. This note was superseded by the user-directed 2026-09-27 release closeout below. Task 09 remains **PARTIAL**; the remaining UI, media-key, and hosted operational gates stay unresolved.


## 2026-09-26 current-state closeout evidence

The latest local verification confirms Docker Engine 29.8.0 is responding, the existing local Supabase core containers are healthy, and `supabase migration list --local` reports all 12 migrations matched. `npx tsc --noEmit` exited 0, the local app at `http://127.0.0.1:3001/` returned HTTP 200, and an isolated `next build --webpack` exited 0 from a staging copy with local placeholder build values. This was a Webpack build; it is not evidence of a Turbopack build or hosted deployment. No local database reset or hosted changes were made.

A Hybrid Browser Tester used CUA pointer input at 1265×720 to pass the member home filter, menu detail, my-review search, favorite/unfavorite, other-user like/unlike, review edit cancel, and 0.5 half-star select/deselect/restore flows. Test state was restored. The Lead separately confirmed no document-level horizontal overflow on the home page at widths 360, 390, 768, and 1440. No screenshots were saved. These observations add targeted evidence only; they do not complete the 57-case role/viewport matrix.

Still unverified: guest and owner/server-admin flows; full role/path/viewport coverage; back/forward in this newest pointer pass; saved screenshots; positive local Vault/HMAC image verification; release of a PENDING intent when its Storage object is missing; independent proof of the original-file byte claim; data import/checksum reconciliation; and hosted Supabase/Vercel gates. The QA review by `QA 사진 확인자` remains on menu 12 and was not deleted; preserve the pre-existing `QA 사진 작성자` review. Any deletion requires immediate action-time confirmation.

Historical snapshot: this scoped run recorded Task 09 **PARTIAL** and Task 10 push blocked. It was superseded by the user-directed 2026-09-27 release closeout below. Earlier full/resumed run audits reported provenance findings (including missing expected actions, decision/action mismatches, file-scope/ownership mismatches, missing decision links, and role-ownership mismatch); those findings remain part of the historical record and are not erased by this closeout.


## 2026-09-26 residual route-only QA continuation

A Hybrid Tester run (`yum-review-task09-residual-qa-20260926`) was limited to checking the available CUA browser inventory. It found only the Codex In-app Browser; a second tab inherited the existing authenticated `QA 사진 확인자` session. The tester did not log out, mutate state, or claim guest browser coverage. Its bounded actor self-report is `reported` and linked to the run decision. The scoped Hybrid audit contains 16 decisions, 2 orchestration events, and 1 actor artifact, with zero findings.

Separately, the Lead performed cookie-free, read-only HTTP checks against local port 3001. Routes `/`, `/login`, `/signup`, `/menus/12`, and `/restaurants/12` returned 200. `/account`, `/my-reviews`, `/wishlist`, `/admin`, and `/restaurants/12/manage` redirected (307) to `/login`. The home route returned 200 with query values for search, overall sort, and Korean category. Query contents are not reproduced. These requests verify route responses only; they do not establish visual guest rendering, UI control behavior, search correctness, history navigation, or responsive behavior. No screenshots were saved and no state-changing action or hosted service/config/secret access occurred.

Historical snapshot: at the time this note was written, Task 10 push was blocked. The statement was superseded by the user-directed 2026-09-27 release closeout below. The applicable QA matrix rows are PARTIAL only: pointer rows 4, 6, 13, 16, 18, 27, 35, 42; route-protection evidence rows 12, 14, 42, 43, 44. Full guest/member/owner/server-admin and 57-case role/viewport acceptance remains incomplete. Positive Vault/HMAC verification, missing-object PENDING release, source/target import/checksum reconciliation, and hosted Supabase/Vercel gates remain open. Preserve both QA reviews; deletion requires immediate action-time confirmation. Task 09 remains PARTIAL.


## 2026-09-27 release pre-push review and user-directed deployment

The user explicitly requested a GitHub push and verification of the real Vercel deployment on 2026-09-27. This overrides the earlier internal sequencing that blocked Task 10 until Task 09 acceptance; the requested code push and Vercel check may proceed after local review/build checks. Task 09 remains **PARTIAL** and product acceptance is not inferred from this release instruction. Hosted Supabase/Auth/Storage/import checks remain unverified and are separate from Vercel's automatic deployment.

The pre-push member pointer check confirmed the half-star control moved 0.5 → 1.0 and cleared when the selected rating was clicked again. The form was restored to 5.0 and canceled without saving. A code reviewer found no source defect in `ReviewForm`; it found the stale 15-second statement in `.planning/phases/03-nextjs-supabase/SECURITY-REVIEW.md` and a state wording issue that still described the user-directed push as blocked. The security statement has been corrected to state the 3,600-second source configuration, untested local/CDN/cache behavior, and remaining stale-cache risk.

The release-prepush Hybrid audit was persisted with 19 decisions, 4 events, and 2 actor artifacts. It has exactly one `FILE_OWNERSHIP_MISMATCH`: the read-only code reviewer reported nine inspected files while its task declared an empty file scope. Preserve that finding; this run is not clean. The separate Tester report is `reported`.

Historical snapshot: the GitHub push and Vercel verification were still proceeding when this note was written. This statement was superseded by the user-directed release closeout below. Task 09 remains **PARTIAL**. Preserve the unresolved 57-case role/viewport and guest/owner/server-admin QA, positive local Vault/HMAC image verification, missing-object PENDING release, original-file byte-claim proof, import/checksum reconciliation, hosted Supabase/Auth/Storage configuration, and the QA review on menu 12. Keep Vercel automatic deploy distinct from those hosted Supabase and import gates.

## 2026-09-27 release closeout

Historical snapshot: commit `a9d513f9d850c9395ae586da07488fc11451b4d7` and deployment `6681498070` were the observed release at that point. This was superseded by the final closeout evidence below.

Hosted Supabase/Auth/Storage/SMTP configuration, live data counts, import/checksum reconciliation, and production import remain unverified. Vercel deployment success does not establish those gates. Task 09 remains **PARTIAL**.

The release-prepush audit remains 19 decisions, 4 events, and 2 actor reports, with one `FILE_OWNERSHIP_MISMATCH` because the read-only reviewer reported nine inspected files outside its declared empty file scope. Do not treat it as clean. The release-reconciliation audit has 16 decisions, 1 event, and 0 actor reports; its zero-finding result does not cover the worker's missing self-report, because the worker reported it could not write its actor artifact. That provenance gap also remains explicit.

## 2026-09-27 final release closeout (supersedes prior in-progress/blocked notes)

Commit `72c836be8546bf607d1edd614681553bf1148a97` is on `origin/main`. Vercel Production deployment `6681638995` succeeded at `https://yum-review-lx0uyallh-suh6.vercel.app`. After this deployment, the public alias `https://yum-review.vercel.app` was re-opened: the homepage still reports catalog-load failure and `/menus/12` still reports menu-detail load failure; `/login` and `/signup` render. The cause is unknown because the application broadly catches environment/client/query errors; configuration failure must not be inferred. No production data or settings were touched.

The final closeout Hybrid run records 16 decisions, 2 action events, and 2 actor reports; deterministic `auditDecisionTrace` returned zero findings. Both actor reports came from one Implementer. The current deterministic audit did not flag this report-count anomaly, which remains a provenance limitation. Preserve the pre-push `FILE_OWNERSHIP_MISMATCH` and the reconciliation worker's missing self-report described above. Task 09 remains **PARTIAL**; hosted Supabase/Auth/Storage/SMTP configuration, hosted data and import/checksum reconciliation, and production import remain open and unverified. Vercel deployment success does not establish those gates.


## 2026-09-27 promoted hosted catalog diagnosis

Hybrid run `catalog-live-repair-2026-09-27` routed its Implementer explicitly to `gpt-6-sol/high` for the user-requested promotion. Anonymous read-only requests to the supplied hosted Supabase project returned HTTP 404 `PGRST205` for both `public.menus` and `public.restaurants`: these tables are absent from the exposed Data API schema cache. This confirms a backend catalog availability defect; SQL access is still required to distinguish unapplied migrations from API exposure/cache configuration. No source fallback or RLS bypass was added.

The direct PostgreSQL endpoint has an AAAA record only; the exact resolved IPv6 connection failed `ENETUNREACH`. One read-only Session pooler connection attempt each to the bounded aws-0 Seoul, Tokyo, and Singapore endpoints returned `XX000` tenant/user not found. The local environment file points to local Supabase, and has no hosted database URL. Values were handled in memory and not included in diagnostic outputs or this record. The exact project IPv4 Session pooler host from the Supabase Connect dialog, or authenticated SQL dashboard access, is required to continue the hosted repair. No migration, row, Auth, or Storage write occurred on the hosted project.

The user explicitly authorized database repair additions/deletions and pushing, with the invariant that Gompocha menu rows must survive. The legacy local `yum_review_mvp` source still contains Gompocha Jukjeon restaurant ID 6, 40 menus and 40 photo associations. A bounded ordered ID/name/price/photo-ID/photo-URL fingerprint is `bd43e711ffc0a66bb684530c4d4c3759bc3f723ef0ffd9b09f1b65dc8f7ee1cc`. The user-provided ZIP dry-run validates 40 images totaling 11,576,811 bytes and performs no DB/Storage connection. The local Supabase disposable target contains a QA restaurant only and is not the Gompocha source. No source data was changed. A remote pre-mutation Gompocha fingerprint remains unverified because hosted SQL access is unavailable.

The public Vercel catalog defect remains open; Task 09 stays **PARTIAL**. The existing source type/build evidence cannot prove that remote backend tables are deployed.
