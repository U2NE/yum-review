# Privacy-safe catalog and purge preflight

This runbook defines the local preflight artifacts for the approved purge plan. The commands in this task do not connect to hosted Supabase, Vercel, the legacy database, or production Storage, and they do not mutate application data.

## Preflight checks

1. Derive the role/viewport suite from `docs/migration/ui-qa-matrix.md` and verify the checked-in suite:

   ```powershell
   npm run qa:browser-matrix -- --suite docs/migration/browser-qa-57.json --dry-run
   ```

   A passing dry run reports 57 scenario families and 394 unique role/viewport executions. Row 53 covers guest, member, owner, and server-admin at 360px and 1440px. Each pair has a stable `caseId`. The dry run compares the complete generated structure with the source matrix.

2. Exercise only the hermetic local owner fixture:

   ```powershell
   npm run test:owner-menu-fixture
   npm run test:integration
   ```

   The fixture uses synthetic in-memory rows, covers menu add/edit/activation and photo add/replace/remove, rejects cross-owner operations, and removes only IDs created by its own fixture run. It has no service connector.

3. Validate the opaque manifest implementation:

   ```powershell
   npm run qa:catalog-manifest -- --self-test
   ```

   For a later operator-supplied local snapshot, pass `--input <snapshot.json>` and inject `CATALOG_MANIFEST_HMAC_KEY` through the approved secure runtime. Use the same runtime key for before/after snapshots. Do not put the key in arguments, tracked files, shell history, or evidence. The manifest emits aggregate counts, HMACs for restaurant/menu rows, keyed opaque path and byte hashes for retained MENU photos, and separate Gompocha counts/hashes. It does not emit names, raw paths, UUIDs, account identifiers, emails, coordinates, review content, or key material.

## Matrix write boundary

The browser runner has a fail-closed production guard for every family classified as catalog/menu or menu-photo mutation. Production owner menu checks remain read-only; successful owner CRUD/photo coverage is confined to the disposable local fixture. This preflight build includes only matrix generation, dry-run comparison, and the guard. It has no browser execution adapter and makes no browser or network request.

## Personal-data write freeze

Both database migrations install the freeze inactive. The Supabase and legacy status RPCs are read-only; guarded application routes and PostgREST writes fail closed when the state is active or cannot be read. Database row triggers take a shared transaction advisory lock. Activation takes its matching exclusive lock, waits for admitted transactions to finish, records the exact `yum-overhaul-20260928` run, and releases the lock only after the frozen state is visible. Reads remain available. The retained restaurant/menu tables are guarded too.

The Supabase SQL tests are in `supabase/tests/personal_data_write_freeze.sql`. `npm run test:schema:disposable` and `npx supabase test db` must run only against a disposable local Supabase stack. `npm run qa:purge-freeze -- --self-test` checks source invariants; it is not a database, Storage API, Auth concurrency, or TUS proof. Never point these checks at a linked project.

The operator CLI recognizes `--preflight`, `--freeze`, `--verify`, and `--release`, each bound to an explicit `--run-id yum-overhaul-20260928`. These modes currently return `BLOCKED` without attempting a database, filesystem, or Storage operation: this checkout has no approved disposable database/Storage adapter, so it cannot verify migration identity, active upload drain, cross-target postconditions, or TUS quiescence. The CLI also requires the `YUM_PURGE_FREEZE_OPERATOR_AUTH` signal; its presence is not credential validation and cannot bypass the missing-adapter or evidence blockers. Do not treat a recognized command or an exit status from `--self-test` as freeze, purge, verification, or release evidence.

The current migration deliberately keeps `attest_personal_data_tus_quiescence` false. The deployed Storage implementation's full resumable-upload inventory and cancellation path have not been proven here, so every purge step remains blocked. It also requires a real local Storage API insert by the separately marked temporary Auth identity to observe the non-forgeable database `session_user`; until that principal is observed and shown not to be assumable by ordinary roles, the RLS/API delete path is blocked. Do not substitute `service_role`, project-owner SQL deletion, a caller-set GUC, or an operator-supplied digest for either proof. Keep the freeze active if either check is unavailable.

The Spring filesystem command is disabled unless `yum-review.media.review-purge.enabled=true` is explicitly supplied to that local operator invocation. It reads `YUM_PERSONAL_DATA_PURGE_RUN` and `YUM_REVIEW_MEDIA_DIR` from the process environment and accepts no path, glob, or ID arguments. Before invoking it, freeze all Spring writes, prove every upload transaction drained, and record the all-instance/all-volume inventory through the exact-run operator attestation. It refuses to run without the active exact run, that inventory attestation, and a reachable configured root plus its dedicated `tmp` directory. It scans the complete root before deletion, rejects symlinks, traversal, subdirectories, unknown files, and unknown temporary entries, deletes only direct-child `review-<UUID>.webp` and dedicated staging/output files, then compares the retained `menu-<UUID>.webp` count and content digest. Run it once for every attested reachable volume. An unavailable instance, media volume, or temp directory blocks all deletion.

The scoped source checks do not prove that a hosted or local runtime has the required Storage principal, Auth transaction drain, TUS cancellation, Spring volume inventory, or cross-instance behavior. Those checks stay BLOCKED until their disposable runtimes and independent security review are available.

## Purge journal and forward recovery

The journal target order is fixed:

1. `supabase-review-storage`
2. `supabase-db-auth`
3. `legacy-review-media`
4. `legacy-db`

Each bounded target phase must persist `STARTED` before work and `COMMITTED` only after verification proves zero remaining target rows/objects and supplies retained-menu path/byte HMACs matching the original persisted catalog baseline. One exclusive journal claim holds across target start, adapter execution, preservation comparison, and commit, so concurrent coordinators fail closed while a target is active and committed targets are always skipped. A target may be retried while it is `STARTED`; interrupted execution leaves that checkpoint for forward-only reconciliation. The journal accepts only aggregate counts, fixed target names, timestamps, and 64-character keyed HMACs. It refuses skipped targets, extra fields, a mismatched run ID, incomplete remaining counts, and a concurrent/stale journal lock. A leftover lock requires operator reconciliation; do not delete it automatically.

The preflight order is: confirm exact approval and completed QA cleanup ledger; check freeze controls without taking a personal-data count; activate and verify the cross-target freeze and direct-bypass denials; only then capture catalog evidence and begin target checkpoints. On any target failure, leave the freeze active and resume from the first non-committed checkpoint. Never restore deleted personal data.

Before target execution, the future run-specific adapters must implement the approved fixed-run database procedures, allowlists, official Storage API boundary, legacy media-root checks, and all freeze/drain probes. They must cover every reachable app instance and configured media volume. This repository preflight does not configure those adapters. The `qa:purge` command therefore stops before target access when no such adapter is installed.

Keep the freeze active through zero-count verification, before/after restaurant/menu/MENU-photo count and keyed hash comparison, all committed target checkpoints, and durable final evidence. Include Gompocha in the preserved catalog comparison. Null only approved uploader/attestor references; preserve every restaurant/menu row, MENU path, and MENU photo byte. The retained former-uploader UUID segment in a menu object path remains a disclosed residual locator and must never be printed.

Reopen supported signup and personal-data writes only as the last successful purge operation, after final evidence is durable. If a target is unavailable, a freeze probe succeeds unexpectedly, a catalog hash changes, an unknown media entry exists, or final counts are nonzero, stop with reached targets frozen. Do not claim a production purge or readiness result from the local preflight checks.
