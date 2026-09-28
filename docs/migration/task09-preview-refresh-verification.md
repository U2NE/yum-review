# Task 09 ImageUpload removal and preview verification

Run: `task09-remaining-gates-20260927`
Revision: 8
Task: `task09-image-upload-remove-photo-verification`
Verifier: independent, bounded source and typecheck pass

## Acceptance checks

| Check | Result | Evidence |
|---|---|---|
| A successful photo detach prevents an already-running preview read from restoring the removed item | PASS by static control-flow inspection | In `components/media/ImageUpload.tsx`, `removePhoto` awaits `detachMenuPhoto`/`detachReviewPhoto`, increments `refreshGeneration.current`, then filters the item from the latest state and notifies `onChange`. `reloadMedia` captures the generation before awaiting and only commits if it is still current. A refresh resolving during the detach can update before detach success, but the following local filter removes the detached item; one resolving after success fails the generation check. |
| A failed detach preserves the preview | PASS by static control-flow inspection | The generation increment and local filtering occur after the awaited detach. A rejected detach enters `catch` before either operation and reports the error. |
| Cleanup-queue failure does not restore the photo | PASS by static control-flow inspection | Local filtering occurs immediately after a successful detach and before queueing cleanup. A queue failure reports an alert but keeps the photo hidden. |
| Refreshes from earlier component/effect identity cannot commit | PASS by static control-flow inspection | `reloadMedia` checks its captured generation before `setMedia`; effect cleanup increments the same ref after clearing its timer and listener. |
| Background polling and visible-tab refresh handling remain correct | PASS by static control-flow inspection | The interval and `visibilitychange` listener share `refreshIfVisible`, which does nothing when `document.hidden`; visible transitions request a refresh. |
| TypeScript project check | PASS | `npx tsc --noEmit` exited 0 with no diagnostics. |
| Whitespace/error check | PASS | `git diff --check` exited 0. Git emitted only LF-to-CRLF working-copy notices for existing modified files. |
| Browser removal-vs-refresh behavior | NOT RUN | The local QA URL `http://127.0.0.1:3002/` refused connection, and fixture inspection recorded no attached synthetic photo safe for deletion. No photo or database row was changed. |

## Cross-check of independent evidence

The latest static review in `docs/migration/code-review.md` independently confirms the generation invalidation ordering, detach-failure behavior, and cleanup-queue behavior. `docs/migration/ui-qa-matrix.md` and `docs/migration/local-runtime-verification.md` record that the current local browser was unreachable and that no attached synthetic fixture photo existed; earlier owner-panel evidence is explicitly limited to an empty menu-photo state. Those records support keeping the dynamic check as NOT RUN.

## Scope and disposition

This verification covers only the `ImageUpload` remove-versus-preview-refresh race and nearby refresh guards. It does not establish browser behavior, authenticated uploads, storage cleanup, hosted behavior, or the broader role/viewport acceptance matrix. No application source, database, Storage object, hosted setting, or secret was changed or read for this pass. Task 09 remains **PARTIAL**; dynamic remove behavior must be retested when a disposable attached photo and reachable local runtime are available.
