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

Task 09 remains **PARTIAL**. The old record that Docker blocked authenticated QA is historical; the newly appended local observations supersede it. The remaining UI, media-key, and hosted operational gates stay unresolved. Task 10 push is not performed from this partial acceptance state; the previously reported Vercel success applies only to the already-pushed `d135989` commit, not these local notes.


## 2026-09-26 current-state closeout evidence

The latest local verification confirms Docker Engine 29.8.0 is responding, the existing local Supabase core containers are healthy, and `supabase migration list --local` reports all 12 migrations matched. `npx tsc --noEmit` exited 0, the local app at `http://127.0.0.1:3001/` returned HTTP 200, and an isolated `next build --webpack` exited 0 from a staging copy with local placeholder build values. This was a Webpack build; it is not evidence of a Turbopack build or hosted deployment. No local database reset or hosted changes were made.

A Hybrid Browser Tester used CUA pointer input at 1265×720 to pass the member home filter, menu detail, my-review search, favorite/unfavorite, other-user like/unlike, review edit cancel, and 0.5 half-star select/deselect/restore flows. Test state was restored. The Lead separately confirmed no document-level horizontal overflow on the home page at widths 360, 390, 768, and 1440. No screenshots were saved. These observations add targeted evidence only; they do not complete the 57-case role/viewport matrix.

Still unverified: guest and owner/server-admin flows; full role/path/viewport coverage; back/forward in this newest pointer pass; saved screenshots; positive local Vault/HMAC image verification; release of a PENDING intent when its Storage object is missing; independent proof of the original-file byte claim; data import/checksum reconciliation; and hosted Supabase/Vercel gates. The QA review by `QA 사진 확인자` remains on menu 12 and was not deleted; preserve the pre-existing `QA 사진 작성자` review. Any deletion requires immediate action-time confirmation.

The current scoped run records only the evidence above and leaves Task 09 **PARTIAL** and Task 10 push blocked. Earlier full/resumed run audits reported provenance findings (including missing expected actions, decision/action mismatches, file-scope/ownership mismatches, missing decision links, and role-ownership mismatch); those findings remain part of the historical record and are not erased by this closeout. The current run's final scoped audit is owned by the Lead and should be consulted for its findings; do not describe it as clean before that audit is written.


## 2026-09-26 residual route-only QA continuation

A Hybrid Tester run (`yum-review-task09-residual-qa-20260926`) was limited to checking the available CUA browser inventory. It found only the Codex In-app Browser; a second tab inherited the existing authenticated `QA 사진 확인자` session. The tester did not log out, mutate state, or claim guest browser coverage. Its bounded actor self-report is `reported` and linked to the run decision. The scoped Hybrid audit contains 16 decisions, 2 orchestration events, and 1 actor artifact, with zero findings.

Separately, the Lead performed cookie-free, read-only HTTP checks against local port 3001. Routes `/`, `/login`, `/signup`, `/menus/12`, and `/restaurants/12` returned 200. `/account`, `/my-reviews`, `/wishlist`, `/admin`, and `/restaurants/12/manage` redirected (307) to `/login`. The home route returned 200 with query values for search, overall sort, and Korean category. Query contents are not reproduced. These requests verify route responses only; they do not establish visual guest rendering, UI control behavior, search correctness, history navigation, or responsive behavior. No screenshots were saved and no state-changing action or hosted service/config/secret access occurred.

The applicable QA matrix rows are PARTIAL only: pointer rows 4, 6, 13, 16, 18, 27, 35, 42; route-protection evidence rows 12, 14, 42, 43, 44. Full guest/member/owner/server-admin and 57-case role/viewport acceptance remains incomplete. Positive Vault/HMAC verification, missing-object PENDING release, source/target import/checksum reconciliation, and hosted Supabase/Vercel gates remain open. Preserve both QA reviews; deletion requires immediate action-time confirmation. Task 09 remains PARTIAL and Task 10 push remains blocked.


## 2026-09-27 release pre-push review and user-directed deployment

The user explicitly requested a GitHub push and verification of the real Vercel deployment on 2026-09-27. This overrides the earlier internal sequencing that blocked Task 10 until Task 09 acceptance; the requested code push and Vercel check may proceed after local review/build checks. Task 09 remains **PARTIAL** and product acceptance is not inferred from this release instruction. Hosted Supabase/Auth/Storage/import checks remain unverified and are separate from Vercel's automatic deployment.

The pre-push member pointer check confirmed the half-star control moved 0.5 → 1.0 and cleared when the selected rating was clicked again. The form was restored to 5.0 and canceled without saving. A code reviewer found no source defect in `ReviewForm`; it found the stale 15-second statement in `.planning/phases/03-nextjs-supabase/SECURITY-REVIEW.md` and a state wording issue that still described the user-directed push as blocked. The security statement has been corrected to state the 3,600-second source configuration, untested local/CDN/cache behavior, and remaining stale-cache risk.

The release-prepush Hybrid audit was persisted with 19 decisions, 4 events, and 2 actor artifacts. It has exactly one `FILE_OWNERSHIP_MISMATCH`: the read-only code reviewer reported nine inspected files while its task declared an empty file scope. Preserve that finding; this run is not clean. The separate Tester report is `reported`.

The user-directed GitHub push and actual Vercel deployment verification are proceeding after local checks; neither is claimed complete in this record. Task 09 remains **PARTIAL**. Preserve the unresolved 57-case role/viewport and guest/owner/server-admin QA, positive local Vault/HMAC image verification, missing-object PENDING release, original-file byte-claim proof, import/checksum reconciliation, hosted Supabase/Auth/Storage configuration, and the QA review on menu 12. Keep Vercel automatic deploy distinct from those hosted Supabase and import gates.

## 2026-09-27 release closeout

Commit `a9d513f9d850c9395ae586da07488fc11451b4d7` was pushed to `origin/main`. GitHub reports Vercel Production deployment `6681498070` as successful at `https://yum-review-4tt94wkps-suh6.vercel.app`; the public alias `https://yum-review.vercel.app` is reachable. Browser checks on the public alias confirmed the homepage, `/login`, and `/signup` render. The homepage reports that menu loading failed, and `/menus/12` reports that menu detail loading failed. The deployment-specific URL redirects to Vercel login while the stable alias is public. No live forms were submitted and no production data or settings were changed. The catalog-load failure cause is unknown and is not inferred here.

Hosted Supabase/Auth/Storage/SMTP configuration, live data counts, import/checksum reconciliation, and production import remain unverified. Vercel deployment success does not establish those gates. Task 09 remains **PARTIAL**.

The release-prepush audit remains 19 decisions, 4 events, and 2 actor reports, with one `FILE_OWNERSHIP_MISMATCH` because the read-only reviewer reported nine inspected files outside its declared empty file scope. Do not treat it as clean. The release-reconciliation audit has 16 decisions, 1 event, and 0 actor reports; its zero-finding result does not cover the worker's missing self-report, because the worker reported it could not write its actor artifact. That provenance gap also remains explicit.
