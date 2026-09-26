# Local Supabase Runtime Verification

Run date: 2026-09-26 (Asia/Seoul)  
Scope: final shared workspace snapshot; local Supabase only; synthetic fixtures only.

## Results

| Criterion | Result | Evidence |
|---|---|---|
| Local stack start | PASS | `npx --yes supabase@2.118.0 start --exclude studio,logflare,vector` started the local database, Auth, REST, Storage, Realtime, Edge Runtime, and supporting services. Studio, Logflare, and Vector were excluded. The CLI returned local service status. |
| Migration chain | PASS | The local migration ledger recorded all 11 files in order, from `20260925130000_application_schema` through `20260926180001_media_verification_cleanup_bounds`. The corrected cleanup-bounds migration applied successfully. |
| Core schema and RLS | PASS | All eight exposed application tables were present, and RLS was enabled on `public.reviews`. Synthetic authenticated and anonymous role contexts exercised the reviewed policies. |
| Role helpers and owner/admin RPCs | PASS | The synthetic owner received only its assigned restaurant in `get_my_access()` and could create a menu upload intent. A non-owner was denied that intent and saw zero rows from the owner's verification-intent RPC. The synthetic admin received the admin flag, successfully assigned an owner through `admin_set_restaurant_owner`, and could list owner rows. Private role-table SELECT and authenticated execution of the server-only slot RPC were both false. |
| Media verification intent and quota | PASS | An authorized pending intent was returned to its uploader. Sequential calls to `consume_media_verification_attempt` allowed attempts 1–5 and denied attempt 6 with a 60-second retry value. |
| Invalid-ID quota behavior | PASS | Missing and other-user media UUIDs returned zero rows from the attempt RPC; the caller's quota table remained empty, so neither request acquired a slot nor charged quota. |
| Service-only verification slot and contention | PASS | `service_role` claimed and released slots for two authorized pending synthetic uploads. A third concurrent claim was denied with a 90-second retry value, confirming the global two-slot cap. Authenticated lacked EXECUTE on the claim RPC. |
| Storage policies and lifecycle | PASS | The bucket existed and all five migration policies were present. A synthetic object was visible to anon while linked to an active menu; detaching it changed the asset to `DELETE_PENDING` with a future grace deadline, hid it from anon, and made `can_delete_media_path` false during the grace period. |
| Vault key parity and positive image-verification route | NOT RUN | No synthetic Vault validation key or local Next.js verification environment was configured. The authorized key-preflight RPC failed closed with `false`, as expected. Positive HMAC proof activation and actual image decoding through the HTTP route therefore were not exercised. |

## Fixture handling and cleanup

The test users, restaurant/menu/review rows, media intents, object rows, quota rows, and slot leases were created in disposable SQL transactions and rolled back. After the initial verification, the CLI stopped the stack and a container check found no running Supabase containers. For the requested button-level UI QA, the same local stack was then started from its existing backup with the same optional services excluded; it is currently running, with its named local resources preserved. No reset was run. No hosted Supabase, production credentials, real user data, or production media were used.

The earlier startup attempt had applied migrations to an empty fresh local database before failing optional-service health checks; it had no fixtures. The retry above excluded Studio, Logflare, and Vector and completed with the migrations applied.

## Post-remediation verification (2026-09-26)

This pass used the existing disposable local database only. No reset, reinitialization, hosted connection, or remote migration was performed.

| Criterion | Result | Evidence |
|---|---|---|
| New migration application and history | PASS | `20260926180002_media_and_review_integrity` was the sole pending local migration; `supabase migration up --local` applied it. A follow-up migration listing showed all 12 local files paired with local history through `20260926180002`. |
| Migration reapplication | PASS | Re-executed only the new migration SQL against the existing local database with `ON_ERROR_STOP`; function replacements, trigger recreation, and policy recreation completed successfully. The committed synthetic concurrency fixture remained available afterward, confirming that this did not reset data. |
| Invalid and foreign quota IDs | PASS | Under the caller JWT, an absent UUID and another user's pending media UUID each returned zero rows and created no quota row. |
| Invalid-ID decoder-lock isolation | PASS | One local PostgreSQL session held advisory lock `(19860926, 1730)` for 10 seconds. In a second session, the authenticated invalid-ID quota call returned zero rows in 296 ms, before the lock holder released the shared decoder lock. |
| Per-user quota | PASS | In a rollback-only SQL transaction, one user received five allowed attempts and a sixth denial with a retry value; a second user received an independent first allowed attempt. |
| Slot-claim privilege | PASS | `authenticated` has no EXECUTE privilege on `claim_media_verification_slot_server`; `service_role` does. |
| Own-review inactive-menu visibility | PASS | With RLS enabled, the author of a review saw its deactivated menu; an unrelated authenticated user and `anon` each saw zero rows. |
| Review photo maximum | PASS | A sixth linked photo insert was rejected; deleting one link then inserting a replacement succeeded and left five. |
| Concurrent photo-insert race | PASS | Six simultaneous local PostgreSQL clients attempted distinct photo links to one review. Exactly five committed; the sixth was rejected by `enforce_review_photo_limit()` with the expected constraint error. |
| Exact synthetic fixture cleanup | PASS | The six test asset rows, linked objects (removed through the local Storage API), review/menu/restaurant, and synthetic Auth user were removed by exact fixture identity. Post-cleanup counts for the named restaurant, user, uploader assets, and Storage paths were all zero. No pre-existing rows were targeted. |
| Existing role, storage lifecycle, and broader RLS checks | PASS (prior pass) | These checks remain as recorded above from the earlier local runtime pass; they were not all repeated in this remediation pass. |
| Positive Vault/HMAC and HTTP image-verification flow | NOT RUN | No synthetic Vault validation key or local Next.js verification environment was configured. The fail-closed key-preflight result from the earlier pass remains the only observation. |

The local Supabase database remains running and healthy for browser QA.
