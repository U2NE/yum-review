# Next.js + Supabase migration research

Reviewed 2026-09-25 against current official documentation. Scope: constraints relevant to migrating the existing Spring Boot + PostgreSQL/Flyway + React/Vite Yum Review app to a root Next.js App Router app with Supabase Auth, Postgres, and Storage, while preserving existing users, catalog, reviews, and photos.

## Findings and migration implications

### Next.js SSR session and authorization

- For cookie-based sessions in Next.js, Supabase recommends `@supabase/ssr` with separate browser and server client factories. Server Components cannot write cookies; the Next.js Proxy refreshes tokens and propagates updated cookies. The current Supabase guide says use `proxy.ts`/`export async function proxy` in Next.js 16 and `middleware.ts`/`export async function middleware` in Next.js 15 and earlier. Select the filename for the actual pinned Next.js version.
- Use `supabase.auth.getClaims()` to verify identity when protecting data/pages; use `getUser()` when an up-to-date Auth-server user record is needed. Do not authorize from `getSession()` in server code because it reads cookie/local storage without revalidating identity. Preserve both request and response cookie updates during refresh.
- Do not cache authenticated SSR responses that may set refreshed session cookies. Supabase calls out `dynamic = 'force-dynamic'` for authenticated Next.js pages and requires correct cache headers to avoid one user's refreshed cookie being served to another.
- Migration implication: authenticate each request through the SSR cookie flow and still enforce data authorization in Postgres RLS. A route/page guard alone does not replace RLS.

Official sources: [Supabase SSR client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [Supabase server-side auth guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [Supabase package selection](https://supabase.com/docs/guides/auth/choosing-a-server-package).

### Publishable and secret keys

- A publishable key is intended for browser use when exposed tables have RLS enabled and grants/policies are least-privilege. Supabase's older `anon` key is also non-secret.
- Secret and legacy `service_role` keys bypass RLS and must stay server-only. Use them only for trusted administrative work such as user import/backfill; normal user-facing queries should use the signed-in user's JWT so RLS sees the caller.
- Migration implication: Vercel's public environment values should contain only the project URL and publishable key. Keep any secret key in server-only environment configuration and never bundle it into client code. A privileged import process must be separate from ordinary signed-in requests.

Official sources: [Supabase secure data](https://supabase.com/docs/guides/database/secure-data), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase signing keys and API key transition](https://supabase.com/docs/guides/auth/signing-keys).

### RLS model for Yum Review data

Supabase requires RLS on every exposed table and policies per operation; grants and policies both matter. Enabling RLS without policies blocks access through the Data API. Policies should be scoped to `authenticated`/`anon` explicitly and should use `auth.uid()` for the requester's Auth UUID. Updates need a matching SELECT policy as well as UPDATE policy; use both `USING` and `WITH CHECK` to prevent reassignment of ownership.

Recommended policy intent to encode and review against the actual schema:

| Data | Read | Insert | Update / delete |
| --- | --- | --- | --- |
| Profiles | Publicly expose only profile fields the product intentionally makes public; keep email/private account fields unavailable. | Authenticated user may create only a row with their own Auth UUID. | User may edit only their own profile; constrain editable columns so user-controlled profile data cannot alter role/admin state. |
| Reviews | Publicly readable reviews (or only published reviews if moderation/status exists). | Authenticated user may create only a review whose `user_id` is their Auth UUID. | Owner may edit/delete their own review. Admin override must use a trusted role source. |
| Likes | Public count/aggregate as product requires; otherwise owner-only rows. | Authenticated user may create only their own like. | Usually owner may delete their own like; prevent duplicate likes with a unique constraint. |
| Wishlists | Owner-only rows. | Authenticated user may create only rows with their own `user_id`. | Owner may remove/update only their own entries; prevent duplicate user/item pairs. |
| Owner/admin operations | Never infer admin from client-editable metadata. | Restrict to verified owner/admin role. | Use trusted `app_metadata`/custom access-token claim or a private roles table plus policy logic; do not use `user_metadata` as an authorization source because users can edit it. |

Admin/owner checks are application-specific: establish which existing accounts have privileged roles, migrate that mapping into a trusted source, then apply the check consistently in RLS and any server action. Supabase documents custom access-token hooks/claims for RBAC and warns that user metadata is user-editable.

Official sources: [Supabase RLS policy patterns](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase custom claims and RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac), [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data).

### Storage uploads, access, and photo preservation

- Storage buckets deny uploads by default until policies on `storage.objects` permit them. An upload normally needs INSERT permission. To overwrite/upsert, the caller also needs SELECT and UPDATE permission. Supabase recommends avoiding overwrite paths where possible because CDN propagation can leave stale content.
- New objects receive an `owner_id` from the JWT `sub`; the legacy `owner` field is deprecated. Ownership by itself grants no access: policies must compare `owner_id` with the caller. Objects created through a service key or dashboard have no owner set.
- Standard Supabase uploads are best for small files; Supabase recommends TUS resumable upload for files over 6 MB. The configured global and per-bucket limits also apply (current docs: Free up to 50 MB; paid plans up to 500 GB, subject to bucket limit).
- Migration implication: direct browser-to-Supabase Storage uploads can use the publishable key safely only with bucket/path RLS policies. A common policy design restricts inserts to a dedicated review-photo bucket and a path prefix containing `auth.uid()`, then allows reads according to public/private product behavior and mutations only to the owner. For existing photos backfilled by a privileged service process, do not assume Supabase will populate ownership; preserve the existing file-to-user/review mapping and either encode ownership in the object path/metadata or create a deliberate migration policy/mapping. Do not delete legacy files until new paths and database references are reconciled.

Official sources: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership), [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [Storage size limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

### BCrypt password import

- Supabase Auth stores password hashes with bcrypt. Its official Auth0 migration guide explicitly supports bcrypt and Argon2 hashes and demonstrates creating an Auth user with an existing `password_hash` through the admin API; it also shows preserving verified status via `email_confirm: true`.
- Migration implication: importing existing Spring users with their existing bcrypt hashes is supported in principle through a trusted server/admin import path, avoiding forced password resets for compatible hashes. Import the account's existing email-verification state and map the Auth UUID to profile/review foreign keys; never copy password hashes into a public app table.
- Verification limit: official documentation confirms bcrypt generally, but does not explicitly guarantee every Spring `BCryptPasswordEncoder` version/prefix/strength variant. The exact encoded format used by this repository's user population cannot be confirmed from the documentation alone. Before cutover, verify representative existing hashes against a non-production Supabase Auth import and sign-in. If incompatible, use a first-login credential migration/reset strategy rather than assuming compatibility.

Official sources: [Supabase Auth0 migration guide](https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0), [Supabase password security](https://supabase.com/docs/guides/auth/password-security).

### Email confirmation, SMTP, and redirect configuration

- On hosted Supabase projects, email confirmation is enabled by default; with confirmation enabled, users need to confirm before first sign-in. Disabling confirmation implicitly marks email as verified, so it is not equivalent to migrating a verified/unverified flag.
- Supabase's default email sender is best-effort, limited to project team/pre-authorized addresses, and currently limited to 2 emails/hour. Supabase says it is for testing and recommends configuring custom SMTP for production. Confirmation, recovery, magic-link/OTP flows rely on outbound email.
- Site URL and allowed redirect URLs are critical for confirmation and password reset redirects. Configure production and any needed preview URLs deliberately; templates can use `{{ .ConfirmationURL }}`/`{{ .RedirectTo }}`.
- Migration implication: preserve each old account's confirmed/unconfirmed state (confirmed users can be created with `email_confirm: true`). For unconfirmed users, decide whether to send new confirmation messages or retain the unconfirmed state. Do not assume production emails will work through Supabase's default SMTP.

Official sources: [Supabase general Auth configuration](https://supabase.com/docs/guides/auth/general-configuration), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [password Auth](https://supabase.com/docs/guides/auth/passwords), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

### Next.js / Vercel request and upload limits

- Vercel Functions have a 4.5 MB maximum request or response payload; over-limit requests return 413 `FUNCTION_PAYLOAD_TOO_LARGE`. This is the deployed serverless-function limit and applies even if a Next.js Route Handler can parse multipart `Request.formData()`.
- Migration implication: avoid routing review photo bytes through a Vercel Route Handler/server action. Upload from the browser directly to Supabase Storage using the signed-in user's session and Storage RLS, which also avoids converting the upload to base64. Keep any server endpoints focused on metadata/authorization. Supabase Storage's own file-size and bucket restrictions still apply.

Official sources: [Vercel Functions limits](https://vercel.com/docs/functions/limitations), [Vercel payload-too-large guidance](https://vercel.com/docs/errors/function_payload_too_large), [Vercel direct upload guidance](https://vercel.com/docs/vercel-blob/server-upload).

## Assumptions that need project-specific verification

1. Confirm the exact Next.js version before selecting `proxy.ts` versus `middleware.ts`.
2. Inspect the existing auth schema and a representative sample of bcrypt encodings/strengths in the approved secure migration process; the generic bcrypt support documentation does not certify every Spring encoder variant.
3. Determine which existing accounts have owner/admin privileges and which legacy photos belong to which user/review before setting claims, foreign keys, Storage object paths, and policies.
4. Confirm the configured Supabase Storage plan/bucket limit and the largest current photo. The Vercel 4.5 MB limit is documented; the actual upload design should account for Supabase's configured limits separately.
5. Confirm custom SMTP and Supabase Auth redirect allow-list settings operationally before sending confirmation/recovery emails. Production Vercel environment variables being set does not establish these Supabase-side settings.

No application code or data was changed; no credentials or `.env` files were inspected.
