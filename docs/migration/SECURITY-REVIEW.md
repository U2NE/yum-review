# Security review

**Run:** `yum-review-task09-resume-20260926`  
**Task:** `code-security-review`  
**Decision:** `decision-898dcdaf69edd171d90659661bcfe1a3f720c268e094a1727d09a0ab246c413d`  
**Actor:** `security_reviewer_20260926`  
**Attribution:** `reported`  
**Review date:** 2026-09-26

## Scope and method

Read-only static review of the current Next.js/Supabase source and migrations, including the final `CREATE OR REPLACE` media-verification RPC fix. Areas inspected included RLS and function grants, SSR/auth routes, media Storage lifecycle and resumable upload, the location proxy, migration/import/export scripts, and image validation. No hosted Supabase or Vercel service was contacted, no environment secret values were read, and no data or settings were changed. No runtime or synthetic tests were run.

## Findings

### [P2] Invalid verification RPC calls contend on the global lock without consuming quota

`supabase/migrations/20260926180001_media_verification_cleanup_bounds.sql:23-35,72-75`

The RPC acquires the shared transaction advisory lock before it verifies that the supplied media ID belongs to the authenticated caller and is an authorized `PENDING` upload. The function is executable by every `authenticated` role. A logged-in user can call the public RPC directly with random or non-owned UUIDs; these calls return before incrementing that user's quota, while each transaction still takes the global lock used by legitimate verification work. Parallel invalid calls can queue valid verification requests and consume database connection/transaction capacity without being charged to the per-user quota. This requires an authenticated account and direct RPC access; it does not grant access to another user's media or permit an unauthorized write.

**Suggested repair:** Perform the caller/asset eligibility check before taking the shared lock, then recheck the relevant state after locking if needed for race safety. Add request throttling before the global lock so invalid direct RPC calls cannot monopolize the shared gate.

### [P2, deployment-dependent] Location quota trusts `x-real-ip` without verifying the ingress

`app/api/location/search/route.ts:22`; `lib/security/location-rate-limit.server.ts:43-48`; `docs/security/location-search-rate-limit.md:3-5`

The public location route uses the request's `x-real-ip` value as the quota identity. The limiter validates only that the value parses as an IP address before hashing it; the application does not establish that the request came through a proxy that overwrites this header. On the documented Vercel deployment, the design relies on Vercel replacing the header. If deployed behind an ingress that forwards a caller-supplied `x-real-ip`, an unauthenticated caller can rotate arbitrary valid IP values and evade the 20-requests-per-minute quota, increasing Naver API usage. Actual ingress behavior was not verified.

**Suggested repair:** Accept this header only behind a documented, enforced trusted ingress that overwrites it, or derive the client address using the deployment platform's trusted-proxy mechanism. Keep fail-closed behavior when no trusted address is available.

### [P3, upstream-dependent] TUS `Location` is not constrained before forwarding the caller token and image bytes

`lib/media/storage.ts:63-68,71-75,120-138`

After the configured Storage endpoint returns `201`, the browser resolves the `Location` header as a URL but does not require it to have the same origin as the configured TUS endpoint. It then sends the caller's Supabase bearer token and image chunks to that URL in `HEAD`/`PATCH` requests. If an untrusted or compromised upstream can supply a cross-origin `Location`, and that destination permits the application's CORS origin, it can receive the user's access token and the uploaded image. The initial TUS endpoint is itself configured as trusted and no ordinary user-controlled path to a hostile `Location` was found; this finding is conditional on upstream or intermediary behavior.

**Suggested repair:** Require the returned URL to use HTTPS and the exact expected Storage origin (and, if appropriate, the expected resumable-upload path) before issuing any follow-up request. Do not forward the bearer token or upload bytes to a URL outside that allowlist.

## Reviewed areas without another confirmed finding

- **RLS and privileged RPCs:** Migration policies and grants were reviewed statically. The inspected application writes use scoped policies/helpers, and media activation/proof paths are constrained to the caller's pending asset and Storage metadata. Effective grants and policies in any deployed database were not checked.
- **SSR and auth:** Server-side auth guards, cookie-backed Supabase clients, service-role client call sites, password-change checks, and server actions were inspected statically. Live session/cookie behavior was not exercised.
- **Storage verification and image processing:** The inspected upload-intent, activation-proof, lifecycle, size, type, decoded-image, and pixel-count checks form a consistent server-side validation path. Decoder behavior against adversarial files and actual Storage/TUS responses was not tested.
- **Migration/import scripts:** The inspected import paths enforce local loopback/disposable-target constraints before writes; the verifier uses a read-only transaction. Scripts were not executed, and no artifacts or external endpoints were accessed.
- **Location upstream:** The query is length-bounded and encoded into a fixed Naver URL. Its rate-limit identity remains subject to the ingress condition in finding P2 above.

## Not verified

- Runtime behavior of the final SQL migration against local Supabase/Postgres, including lock contention under concurrent requests.
- Whether the deployment ingress overwrites `x-real-ip` on every supported hosting configuration.
- TUS response-origin/CORS behavior for the configured Supabase project.
- Effective hosted Supabase policies, grants, environment configuration, or Vercel settings.
- Adversarial runtime tests for image decoding, import archives, or auth/session flows.

## Follow-up — signed image refresh

**Run:** `yum-review-task09-resume-20260926`  
**Task:** `signed-image-refresh-security-review`  
**Decision:** `decision-b2e1c6d72657c7469e9ced32e730375a74f9821b77f4b550bc6e4befeee766ed`  
**Actor:** `signed_image_refresh_security_reviewer_20260926`  
**Attribution:** `reported`  
**Review date:** 2026-09-26

### Scope and method

Read-only static review of `RefreshableImage`, its menu and review card call sites, the menu detail page, and the related catalog/media query helpers and Storage visibility policies. No tests were run, no secrets were inspected, and no hosted service or data was accessed.

### Authorization review

No confirmed authorization bypass or cross-user URL disclosure was found in the refresh change. Menu image URLs are minted by the server-side Supabase client from menu media metadata. Public review image refresh uses the browser Supabase client; `getReviewPhotoPreviews` reads the requested review links under caller RLS, and each signed URL is minted through that same client. The existing Storage policies limit public signing to active assets linked to an active menu or review. Refresh does not accept a URL from a user-controlled input or introduce a privileged signing endpoint.

As already recorded above, an issued signed URL remains a bearer URL until its one-hour expiry, including after its media link is detached. This behavior is not introduced by this refresh component; immediate revocation was not established by this review.

### [P2, request-rate/resource concern] Review image refresh polls every card every 45 seconds

`components/reviews/ReviewCard.tsx:56-76`; `lib/data/media.ts:75-98`; `lib/data/reviews.ts:36-49`

Each mounted review card immediately fetches its photo previews and starts its own 45-second interval, even when its photos loaded successfully and their signed URLs remain valid for an hour. Each interval calls `getReviewPhotoPreviews`: it queries review-photo links, queries media metadata when links exist, and calls `createSignedUrl` once per image. `fetchMenuReviews` has no explicit pagination or row limit, so a page showing many reviews creates one independent polling loop per returned review. Multiple image errors for the same review can also invoke the same refresh callback concurrently. This is not an authorization bypass, but it creates avoidable repeated database and Storage requests for every guest or signed-in visitor who leaves a review page open.

**Suggested repair:** Remove the fixed 45-second poll and refresh on image failure, or schedule a single refresh near the one-hour expiry. Deduplicate in-flight refreshes per review, batch URL signing where supported, and bound/paginate the review feed. Avoid concurrent whole-page `router.refresh()` calls when several menu images fail together; this path was source-inspected only, and framework request coalescing was not verified.

### Other reviewed behavior

- `RefreshableImage` retries a failed source once; when a changed source fails, its retry guard stops another refresh for that failure cycle. A ten-second fallback prevents a pending refresh from leaving the image indefinitely in a loading state.
- The menu page validates the menu identifier before querying and uses the cookie-backed server client. No service-role key or client-controlled URL was added to the refresh path.
- Runtime behavior of refresh, signed URL expiry, and request coalescing was not verified in this security review.

## Follow-up — review photo polling removal and refresh isolation

**Run:** `yum-review-task09-resume-20260926`  
**Task:** `review-photo-polling-security-review`  
**Decision:** `decision-d5ef1da04f00eeb66503ea7781ba6d8a81fe85f1a02574c955f64e88472e483e`  
**Actor:** `review_photo_polling_security_reviewer_20260926`  
**Attribution:** `reported`  
**Review date:** 2026-09-26

### Scope and method

Read-only static review of `ReviewCard`, `getReviewPhotoPreviews` and the review feed query, plus the relevant review, media, and Storage RLS policies. No tests were run; no secrets, hosted services, or data were accessed.

### Authorization and concurrency

The repeating 45-second interval is removed. A card loads previews once on mount and renews them only after an image failure. Overlapping loads for the same numeric review ID share one in-flight promise; the promise is removed on settlement only if it is still the current map entry. Different review IDs do not share results. Effect cleanup invalidates the review-ID guard, so an unmounted card does not update its state. Errors are caught, and a settled rejected request does not remain in the map.

The promise map is module-global and keyed only by review ID, so two auth identities can coalesce during a session change. I found no confirmed private-photo disclosure under the current policies: the component skips preview loading for the review author, non-author review reads are public for active menus, and private/inactive-review media remains subject to the separate media-asset and Storage RLS checks. Still, include the viewer identity in both the in-flight key and stale-result guard, and rerun the effect when `currentUserId` changes. This keeps the cache aligned with the authorization context and avoids cross-session stale state if page contents or policies change.

### Refresh failure behavior

If preview renewal throws, the catch handler sets the preview list to empty. That removes the image component and its bounded fallback, leaving no inline retry path until the card is loaded again. This is a recoverability/UI gap, not a confirmed authorization bypass. Preserve a visible failed-image state or retry affordance when renewal fails.

### [P2, request-rate/resource concern] Initial photo preview requests still scale with an unbounded review feed

`components/reviews/ReviewCard.tsx:23-35,72-95`; `lib/data/reviews.ts:36-48`

Removing the fixed interval resolves the prior recurring per-card polling cost. However, `fetchMenuReviews` still has no page limit, and every returned non-own review card immediately calls `getReviewPhotoPreviews`. That yields at least one `review_photos` request per card, with additional media metadata and signed-URL requests when photos exist. Same-review deduplication reduces duplicate concurrent refreshes but does not batch requests across cards or cap the initial fan-out. A menu with many reviews can therefore create a large burst of database and Storage requests on each page load.

**Suggested repair:** Paginate or cap the review feed and fetch visible review-photo links in a batch; batch media metadata and signed URL creation where the Storage API supports it. Keep refresh-on-image-error and avoid reintroducing a fixed poll.

### Not verified

This review was static only. Runtime behavior during logout/account switching, transient network failures, and large review feeds was not exercised.

## Follow-up — review photo refresh identity isolation and renewal fallback

**Run:** `yum-review-task09-resume-20260926`  
**Task:** `review-photo-refresh-scope-fallback-security`  
**Decision:** `decision-349d036635a13390e4a7e9e5fae669651000ca6be760a36c5812182c8d90eb3b`  
**Actor:** `review_photo_scope_fallback_security_reviewer_20260926`  
**Attribution:** `reported`  
**Review date:** 2026-09-26

### Scope and method

Read-only static inspection of `ReviewCard`, `RefreshableImage`, the browser Supabase client, review-photo/media preview queries, and the existing review, media-asset, and Storage RLS policies. No tests were run; no secrets, hosted services, or data were accessed.

### Review and closure

- **In-flight request scope:** The preview promise map key contains both the numeric review ID and `currentUserId`. A completion updates card state only while `photoRefreshScope` still equals that request's review-and-viewer scope. The effect establishes and clears this scope and reruns when `currentUserId` changes, so a request from the prior identity is ignored after the new effect scope is active. Different reviews and viewers do not coalesce into the same promise.
- **Caller authorization:** `getReviewPhotoPreviews` receives `createSupabaseBrowserClient()` and performs both the `review_photos`/`media_assets` queries and `storage.createSignedUrl` through that same browser client. It adds no service-role client or signing endpoint. The `review_photos` policy follows visibility of the parent review; review visibility is limited to its author, a server admin, or reviews on active menus. Media metadata and Storage signing are separately constrained by the existing active-linked-media/uploader policies. Static review found no RLS bypass in this refresh path.
- **Renewal failure:** The refresh callback defaults to preserving the existing preview list when renewal fails. `RefreshableImage` still renders its bounded unavailable-image fallback, so the image slot does not disappear. Initial-load failure explicitly clears previews to avoid retaining unrelated prior state.
- **No periodic polling:** `ReviewCard` performs its initial preview request and renews on image error; it has no interval. `RefreshableImage` uses a one-shot ten-second timer only to show the fallback if renewal does not produce a new source; it does not schedule another request.

The previously recorded P2 request-fan-out concern remains: the review feed is not paginated and each visible non-own review loads previews independently. This review confirms that fixed polling is absent, but does not close that separate initial-load scaling finding.

### Not verified

This review was static only. Runtime account switching, a delayed request resolving during logout, signed-URL behavior after policy changes, and transient renewal failures were not exercised. Hosted policies and configuration were not inspected.

## Follow-up — failed review-photo slot preservation

**Run:** `yum-review-task09-resume-20260926`  
**Task:** `review-photo-failed-slot-preservation-security-review`  
**Decision:** `decision-a71b9ff247db795b5127daba297fd0b686143b0302845a53a10ffa82f3e02377`  
**Actor:** `review_photo_failed_slot_security_reviewer_20260926`  
**Attribution:** `reported`  
**Review date:** 2026-09-26

### Scope and method

Read-only static review of the revision-8 `ReviewCard` preview loader/merge path and its `ReviewFeed` and personal-review call sites, `getReviewPhotoPreviews`, `RefreshableImage`, and the relevant review-photo, media-asset, and Storage RLS policies. No tests were run; no secrets, hosted services, or data were accessed.

### Authorization and identity scope

- The in-flight request key is `${reviewId}:${currentUserId}`. The refresh callback captures the same scope and checks `photoRefreshScope` before applying either success or failure results. Effect cleanup invalidates the prior scope, and the effect reruns when the viewer identity or own-review status changes. Thus requests for different reviews or user IDs do not share promises or component state updates.
- A failed slot is retained only when its ID was supplied by an already-rendered photo callback and that ID is present in this card's previous preview list. The merge does not construct a URL or copy an entry from another review; successfully refreshed entries replace old entries, and omitted non-failed entries are dropped. The rejection path likewise retains only failed IDs that already exist in this card's previous state.
- Both the photo-link/media queries and `createSignedUrl` run through the caller's browser Supabase client. The reviewed path adds no service-role client or privileged endpoint. Existing RLS checks the parent review, public active media, or uploader identity. No new RLS bypass or cross-review/user promise-cache path was found.
- `RefreshableImage` swaps a failed image for its fallback, so retaining that failed preview object does not render its old URL as an image. As with any previously issued signed URL, a URL already obtained by a browser remains a bearer URL until its expiry; immediate revocation is not provided by this code.

### Remaining availability limitation

`getReviewPhotoPreviews` converts query failures to an empty list and filters out assets whose signing failed. A refresh for one failed image can therefore remove healthy sibling images when their IDs are omitted from a transient partial/empty response; the patch intentionally preserves only the image IDs that themselves failed. Distinguishing a confirmed detach/authorization loss from a transient query or signing failure would require the helper to return that outcome explicitly.

The initial fan-out concern also remains: `fetchMenuReviews` has no explicit row limit, and each non-own card loads its own photo links. Same-review/user in-flight deduplication does not bound the number of distinct reviews or batch those initial requests.

### Not verified

Static review only. A session switch while a request is pending, same-card prop changes before passive effect cleanup, partial Storage signing failures, and large feeds were not exercised. Hosted RLS, Storage behavior, and deployment settings were not inspected.

## Follow-up — render-time review-photo identity isolation

**Run:** `yum-review-task09-resume-20260926`  
**Task:** `review-photo-render-scope-isolation-security-review`  
**Decision:** `decision-27ab63056e20df0a928d1cb15c7bc3b754c465a05db454e6087ce29822136d8d`  
**Actor:** `review_photo_render_scope_security_reviewer_20260926`  
**Attribution:** `reported`  
**Review date:** 2026-09-26

### Scope and method

Read-only static inspection of revision 9 `ReviewCard`, `getReviewPhotoPreviews`/`getMediaPreviews`, `RefreshableImage`, the review and media RLS policies, and the private Storage bucket policies. No source was changed; no tests, hosted services, environment secrets, or data were accessed.

### Identity, async state, and authorization

- The rendered public-photo list is selected only when the stored `scopeKey` exactly matches the current `${review.id}:${currentUserId ?? ""}`. On a render with a different viewer or review, that comparison hides the old list immediately; it does not wait for the passive effect to clear state. Own-review and guest branches also do not render the public preview list.
- The in-flight preview map and refresh callback are scoped by review ID and viewer ID. Completion checks the active scope before queuing a state update, and the resulting state retains its scope key, so a response from another viewer cannot be rendered under the new viewer key. This is a useful defense even if the old request resolves near an identity transition.
- Preview queries and `createSignedUrl` use the caller's browser Supabase client. The reviewed policies constrain `review_photos` through visible parent reviews, `media_assets` through active linked media or uploader identity, and private bucket reads through the active linked-media predicate. No service-role signing path or new RLS bypass was found in this change.
- A failed slot is retained only for an ID already present in the current card's scoped prior previews and reported by that image's failure callback. It stays in `RefreshableImage`'s fallback state rather than rendering the stale URL as an `<img>`. Refreshed entries replace prior entries; omitted, non-failed IDs are dropped. The rejection path has the same failed-ID restriction.
- `ReviewCard` has no periodic interval; it requests previews on mount and refreshes after an image error. The 10-second timer in `RefreshableImage` only changes the image to its fallback and does not issue another request.

### Remaining concerns

- **Initial lookup still fails silently:** `getReviewPhotoPreviews` and `getMediaPreviews` convert query/signing errors to an empty list. On initial load this means no photo or inline error state appears. On renewal, the failed-slot merge preserves the failed image fallback, but the helper still cannot distinguish a transient error or partial signing failure from a confirmed removed/unauthorized link. A partial result can drop healthy sibling images that were not themselves failed. This is an availability/recoverability gap, not a demonstrated data leak.
- **Initial fan-out remains unbounded:** the review feed has no explicit row limit, and each non-own review card independently loads its photo links. Per-review deduplication does not batch across cards or cap the first-load database/Storage request burst.
- **Separate owner upload polling remains:** `components/media/ImageUpload.tsx:58` still refreshes its private upload preview every 45 seconds. It is outside the public `ReviewCard` photo path reviewed above, but remains a distinct recurring request path and should not be described as site-wide polling removal.
- A signed URL already delivered to a browser remains a bearer URL until expiration even if its link is later detached; render gating does not revoke a URL already issued or cached by that browser.

### Not verified

Static review only. A live account switch during a pending request, React scheduling behavior under rapid prop changes, partial Storage signing failures, and effective deployed RLS/Storage configuration were not exercised.
