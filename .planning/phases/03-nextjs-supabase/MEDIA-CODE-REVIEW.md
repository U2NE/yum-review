# Media hardening code review

Scope: static review of the media verification proof, bounded JSON reader, legacy password-change endpoint, and the three assigned migrations. No application or migration code was changed.

## Findings

### P2 — The 100 MB source-file cap is client-controlled

`app/api/media/verify/route.ts:102-106` reads `original_bytes` from the upload intent and checks only the claimed value. The verifier sees and decodes the already-prepared Storage object; it never receives the original file. The contextual `create_media_upload_intent` RPC accepts `p_original_bytes` from its authenticated caller (`supabase/migrations/20260925130001_rls_and_role_helpers.sql:807-834`). A caller can bypass the browser checks, claim a value below 100 MB, and upload a smaller transformed object; the proof then authenticates that claim. Stored objects are independently capped below 100 MB, but the server cannot guarantee rejection of an original source file at or above 100 MB. Either make this explicitly a client-side source-file check with a server-enforced stored-object cap, or validate the original bytes in a server-observable upload flow.

### P2 — Per-user rate limiting leaves aggregate decode concurrency unbounded

`app/api/media/verify/route.ts:109-134` downloads each object fully and runs Sharp decode with a 40 MP ceiling. The new limiter allows five attempts per authenticated user per minute (`supabase/migrations/20260926172000_media_verification_rate_limit.sql:12-15,48-64`) but does not cap simultaneous calls or aggregate work across accounts. Several concurrent near-100-MB decodes can therefore consume substantial function memory, CPU, and bandwidth. Add a deployment-level/global concurrency budget or move decode work to a bounded worker; verify the chosen limits against the actual runtime memory and duration settings.

## Proof gaps

- Static inspection cannot establish that the migrations apply successfully or that the deployed role can read `vault.decrypted_secrets`, use `extensions.hmac`, and observe `storage.objects.metadata->>'size'` as expected. The RLS, Storage policy, proof replay, and concurrent quota behavior remain unexecuted.
- The proof route intentionally returns 503 until `MEDIA_VALIDATION_KEY_ID` and `MEDIA_VALIDATION_HMAC_KEY` are configured in the app and the matching HMAC secret is provisioned in Vault. Runtime parity of those values is unverified.
- This review did not run a build, database, or browser/runtime check. The bounded JSON helper limits accumulated body bytes and cancels on overflow; runtime transport chunk sizing was not verified.
