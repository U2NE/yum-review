# Confirmation email and auth settings

## Redirects and callback

The local Supabase configuration sets `site_url` to `https://yum-review.vercel.app`, allows that origin plus `http://localhost:3000/**` and `http://127.0.0.1:3000/**`, and points the confirmation template to `supabase/templates/confirmation.html`. These are repository-local settings; they do not change the hosted project.

Set `NEXT_PUBLIC_SITE_URL=https://yum-review.vercel.app` in the production build environment. Next.js inlines `NEXT_PUBLIC_` values used by client code into browser bundles at build time, so this variable must be available while the app is built. Changing it later requires a rebuild and redeploy. Signup sends its confirmation redirect to `/auth/callback` on that configured origin. The callback exchanges Supabase's authorization `code` for a session and redirects only to a validated same-site path. In production, a missing or invalid configured HTTPS origin fails closed; it never falls back to the incoming request host. Only local development can use a loopback request origin.

Before deployment, set the hosted Supabase `Site URL` to the production app origin and allow the exact production callback URL. Keep the localhost and `127.0.0.1` entries for local development only. Supabase compares the requested `emailRedirectTo` against its hosted redirect allowlist, so a link to localhost indicates a hosted URL/allowlist mismatch. The callback keeps `next` same-origin and sends invalid, missing, or expired confirmation codes back to `/login` with a generic confirmation error.

## Confirmation message

The local subject is `한입기록 가입 확인 메일`. The versioned HTML template uses Supabase's `{{ .ConfirmationURL }}` variable as the link target; Supabase documents it as the complete confirmation URL, including the configured redirect. Keep the Korean instructions and link label in visible HTML text. A plain-text equivalent for a mail system that accepts a separate text part is:

```text
한입기록 회원가입을 요청해 주셔서 감사합니다.
아래 확인 링크를 열어 이메일 주소 확인을 마쳐 주세요.
{{ .ConfirmationURL }}
가입을 요청하지 않았다면 이 메일을 무시해 주세요.
```

Hosted email template settings were not inspected or changed. If the hosted project permits template customization, copy the subject and Korean body there and keep the same Supabase variable. The local template alone does not configure the hosted email.

## Sender and delivery limits

The hosted sender identity and SMTP configuration have not been inspected, so their current status is unverified. Supabase says its built-in SMTP is for testing: it only sends to addresses belonging to the project's organization, currently limits sending to 2 messages per hour (a limit that may change), and provides no production delivery SLA. Configure a custom SMTP provider and a sender address/domain you control before production email use; this project has no separate provider or owned sender domain configured here. The signup screen reports that the confirmation request was accepted by Auth and says receipt can vary with mail settings. It does not claim the message was delivered.

Sources: [Supabase custom SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp) and [Supabase email template variables](https://supabase.com/docs/guides/auth/auth-email-templates).

## Passwords and email-existence lookup

The local `supabase/config.toml` sets an eight-character minimum and `letters_digits`; client signup and password-change forms and the server password-change route enforce the same policy: at least 8 characters, one ASCII English letter, and one digit. Case and symbols are optional. Verify and configure the matching hosted Auth password policy before deploying the dependent application code; no hosted setting was inspected or changed here.

The email-existence endpoint allows ten lookups per client IP in a fixed 60-second window. It reads only Vercel's `x-real-ip` header, validates and hashes the address, and persists only that hash with the window counter. Vercel documents `x-real-ip` as identical to `x-forwarded-for` and says it overwrites the forwarded IP to prevent spoofing ([request-header documentation](https://vercel.com/docs/headers/request-headers)). The app does not use `x-forwarded-for` from the request; production requests without `x-real-ip` fail closed. Local development uses one loopback bucket. Neither the lookup route nor the auth form logs submitted email or password values.

The public Supabase Auth sign-up endpoint is a separate path: direct requests do not consume the app's email-status counter, and Supabase may return a duplicate-account signal from `signUp`. The local Auth configuration also limits sign-up and sign-in requests to 10 per IP in a five-minute window through `auth.rate_limit.sign_in_sign_ups` ([Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [local CLI configuration](https://supabase.com/docs/guides/local-development/cli/config)). This provider limit is separate from the app's ten-lookups-per-minute quota. The repository-local setting does not update hosted Auth; verify and configure the hosted sign-up/sign-in rate limit before deployment. Hosted provider settings have not been inspected, so the direct signup path's deployed rate limit remains unverified.
