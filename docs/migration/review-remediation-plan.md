# Review remediation plan

**Run:** `yum-review-task09-resume-20260926` · **Task:** `review-remediation-plan` · **Revision:** 2  
**Decision:** `decision-631ca82a79aed96cc3a06587c8d72c616c76fc6d54bdb904cb08d9ecf920f07a`  
**Date:** 2026-09-26

This plan addresses the confirmed findings in `code-review.md` and `SECURITY-REVIEW.md`. It stays within the approved menu review, image upload, catalog, and migration scope. Keep the existing review scoring, event consent, image eligibility, ownership, and admin boundaries. The inactive-menu exception below is limited to a signed-in author’s own review. Perform implementation checks against disposable local Supabase only; do not access hosted Supabase or Vercel, read secrets, or change live data/settings.

## 1. Implementation

- Add one append-only Supabase migration for the database fixes. Replace the global lock in `consume_media_verification_attempt` with per-user quota serialization. Check that the authenticated caller owns an authorized `PENDING` asset before locking, then recheck after acquiring the per-user lock before charging quota. Missing, foreign, or otherwise invalid IDs return without quota charge and never acquire the shared decoder-slot lock. Keep that shared lock in the server-only slot claim path, after asset eligibility and object-existence checks. Preserve the existing five-attempt window and grants.
- Enforce the five-photo maximum in the database on every insert path. Serialize writes for the same review (for example, by locking its parent review row), count existing photos inside the transaction, and reject an insert that would exceed five. Retain the current owner, active-menu, media-association, uniqueness, and sort-order checks; do not rely on the client cap alone.
- Add authenticated SELECT access for an inactive menu only when `auth.uid()` has a review for that menu. Use a narrowly scoped, fixed-`search_path` helper if needed to avoid recursive RLS evaluation. Keep guests, other users, and public catalog reads unable to discover unrelated inactive menus; retain existing admin/owner access.
- In `lib/media/storage.ts`, resolve each TUS `Location` against the configured endpoint and require the exact expected origin and upload path before sending `HEAD` or `PATCH`. Require HTTPS in production (allow loopback only for local QA), reject credentials/fragments, and prevent automatic redirects from forwarding the bearer token or image bytes. Any permitted redirect must be validated before another request is sent.
- In `lib/data/catalog.ts`, issue signed image URLs with a 60-minute lifetime and refresh an expired URL when a long-lived page needs it. Keep images private and preserve existing signed-read authorization.
- Correct the Task07 contract emitted by the importer and verifier. It must not direct a consumer to the retired one-argument activation RPC. Describe the current proof-bearing public activation signature (`activate_media_upload(uuid, text, text)`) for normal uploads, and describe legacy bulk media import as the separate loopback-only importer transaction that validates mapped ownership, object existence, byte count, checksum, and exact links before activation/association. Keep those paths distinct; never suggest using a user-facing RPC or service-role bypass for bulk import.

## 2. Local database and runtime checks

Apply the new migration to disposable local Supabase, then reapply it to confirm migration safety. Verify concurrently that invalid IDs take no shared decoder lock and do not consume quota; valid requests for one user remain within quota; and independent users do not share quota state. Race more than five photo inserts for one review and confirm no transaction can leave more than five rows; confirm deletion permits a later insert. Check that the author can hydrate their own inactive-menu review while a guest and a different user cannot read that inactive menu.

Use local or mocked TUS responses to exercise relative and absolute `Location` values, cross-origin locations, malformed paths, and redirect responses. Confirm no token or chunk reaches a rejected destination. Verify signed images load after lazy scrolling and can be refreshed after expiry. Check that importer and verifier output show the corrected Task07 contract and that local media import remains idempotent and checksum-bound.

## 3. Independent code and security review

After local checks pass, have someone other than the implementer review the migration, grants, per-user/global lock boundaries, race behavior, inactive-menu RLS helper, TUS origin and redirect handling, signed URL lifetime/refresh, and Task07 handoff output. Resolve findings and repeat the affected local checks before sign-off. Keep this review independent from implementation approval.

Keep the `x-real-ip` concern conditional. Vercel’s current [request-header documentation](https://vercel.com/docs/headers/request-headers) says `x-real-ip` is identical to `x-forwarded-for`, which Vercel overwrites to prevent spoofing. Trust is supported for direct Vercel ingress. If another upstream proxy can reach the route and pass caller-supplied headers, require that ingress to strip and replace the value or use a trusted platform address. Do not treat this as an unconditional Vercel defect without evidence of such an upstream path.

## 4. Real browser UI QA

Run the actual local Next app against disposable local Supabase in a browser. Confirm `/my-reviews` shows a user’s review after its menu is deactivated, while other inactive menus stay unavailable. Exercise adding, replacing, and removing review photos up to the five-photo limit. Upload a file large enough to use TUS and inspect the browser network flow for same-origin requests, blocked redirects, progress, and understandable failure/retry states. Scroll to lazy menu images and verify they load with a fresh or renewed signed URL at the end of its lifetime. Record the viewport and outcomes in the existing UI QA matrix.

## 5. Acceptance verification

Accept the remediation only when the append-only migration passes the local concurrency and RLS checks; invalid IDs do not enter the shared decoder gate; concurrent inserts cannot exceed five photos; own-review access to an inactive menu is isolated; TUS cannot forward credentials or bytes to an unapproved origin or redirect; lazy images recover from expired signed URLs; and the generated Task07 handoff matches the supported upload/import paths. Require independent code/security sign-off and passing real-browser QA. Record any unverified deployment ingress assumption as conditional. No hosted-service or production-data check is part of this plan.
