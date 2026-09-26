# Signed Image Refresh Verification

Run: `yum-review-task09-resume-20260926`, revision 3  
Date: 2026-09-26 (Asia/Seoul)  
Scope: assigned browser verification only; existing disposable local Supabase; no source changes or hosted access.

## Results

| Check | Result | Evidence |
|---|---|---|
| Fresh Next.js production build | PASS | `npm run build` completed compilation, TypeScript, static generation, and route optimization successfully using local process-only Supabase config. |
| Fresh TypeScript check | PASS | `npx tsc --noEmit` exited successfully. |
| Menu card and menu detail photo rendering | PASS | In the in-app browser at `http://127.0.0.1:3001/`, the synthetic menu appeared in the home card and `/menus/10`; the menu detail exposed the photo in the accessibility tree. A post-test reload showed the restored image. |
| Review photo rendering | PASS | `/menus/10` showed the synthetic review and attached photo in the accessibility tree and screenshot. |
| Menu image failure, one refresh attempt, bounded fallback | PASS | After the local app was hydrated, I navigated from the home menu card to `/menus/10` with only the synthetic menu object intentionally made undecodable. The page showed the designed `사진을 불러올 수 없어요` fallback. The current URL remained `/menus/10`. The local Next log recorded the client route request plus one subsequent `/menus/10` refresh request; source inspection confirms `RefreshableImage` refreshes each failed source at most once and then stops (`components/media/RefreshableImage.tsx:62-76`). Catalog refresh re-mints the linked menu URL through the server Supabase client (`lib/data/catalog.ts:241`). |
| Review image failure and bounded fallback | PASS | On the already-rendered review card, the synthetic image object was made undecodable. The card’s next access-checked preview refresh encountered the failure and showed the same bounded fallback without changing the page URL. |
| Review image recovery | PASS | After restoring the same object bytes, the next 45-second preview refresh replaced the fallback with the review photo while the browser stayed on `/menus/10`. The refresh uses the browser Supabase client to read only linked media and mint a new signed URL (`lib/data/media.ts:32-51`; `components/reviews/ReviewCard.tsx:56-81,177-184`). |
| Exact signed-token comparison | PARTIAL | CUA exposed page accessibility and screenshots, not the image `src` query token. The additional route refresh and successful post-restore image load were observed, but I did not log/compare signed URL values. No token or credential was captured in the report. |
| Fixture cleanup | PASS | Only the recorded synthetic restaurant/menu/review, two media assets and Storage objects, and the synthetic Auth user were removed. Follow-up exact-ID/path checks returned zero for restaurant, menu, review, assets, photo links, user, and both Storage objects. No existing fixture or other row was targeted. |

## Test notes

- Local Next.js ran on port 3001 because port 3000 was already owned by an unrelated service. The local Supabase stack was healthy and remained running.
- The menu fixture IDs were restaurant `10`, menu `10`, review `12`; its two media UUIDs and exact object paths were kept only in a temporary fixture record and removed after cleanup verification.
- The review-card refresh path currently waits for its 45-second periodic preview refresh before a failed image is retried. This test exercised that behavior; it did not alter the timer.
- No hosted Supabase, Vercel, production credentials, production data, or production media were used. No repository source files were changed.

## Revision 8 interim rerun — 2026-09-26

This is an interim check of the working tree before the final scope-isolation repair. Re-run the build and browser checks after that patch lands.

| Check | Result | Evidence |
|---|---|---|
| Fresh TypeScript check | PASS | `npx tsc --noEmit` exited 0 with no diagnostics. |
| Fresh Next.js production build | PASS | `npm run build` exited 0; Next.js 16.3.6 compiled, ran its TypeScript step, generated static pages, and finalized routes. |
| Local Supabase availability | BLOCKED | `docker ps` could not connect to the Docker Desktop Linux engine named pipe (`//./pipe/dockerDesktopLinuxEngine`); the engine was unavailable. No Docker or database lifecycle action was taken. |
| Local app at port 3001 | BLOCKED | Local listener check reported port 3001 closed; opening `http://127.0.0.1:3001/` returned `net::ERR_CONNECTION_REFUSED`. |
| Failed review photo → empty/partial refresh behavior | NOT RUN | Could not reach the local app or Supabase. The requested cases (failed slot retention/fallback, valid URL refresh, omitted non-failed slot removal, initial empty/failure clearing, and menu URL stability) remain unverified for this revision. |
| Synthetic fixture | PRESERVED | No fixture row, account, media, or Storage object was read, changed, or removed during this interim rerun. Leave the existing exact synthetic fixture intact for the next browser verification attempt. |

The build and TypeScript results apply to the working tree as it existed at the time of this interim run. They must be repeated after the pending source repair. No repository source files were changed during this check, and no hosted service or credential was accessed.

## Revision 9 scoped verification — 2026-09-26

Scope: fresh build and type-check only. This run used PowerShell process-scoped overrides: the public Supabase URL pointed to loopback (`127.0.0.1:54321`), the public key was a non-secret placeholder, and Supabase server secrets, Naver credentials, Upstash credentials, and the media HMAC key were empty. No hosted endpoint or key was used. I did not inspect `.env.local`.

| Check | Result | Evidence |
|---|---|---|
| Fresh TypeScript check | PASS | `npx tsc --noEmit` exited 0 with no diagnostics. |
| Fresh Next.js production build | PASS | `npm run build` exited 0; Next.js 16.3.6 compiled successfully, ran its TypeScript step, generated static pages, and finalized the route table. |
| Local Docker/Supabase and browser behavior | NOT RUN | The assigned environment reports Docker failing before engine readiness on the `sailor-ingest.sock` startup path. Per instruction, I did not retry Docker, alter its data, or touch local QA fixtures. Browser cases therefore remain for a later instruction when the local stack is available. |
| Source or QA fixture changes | NONE | This run changed no source files and read, changed, or removed no QA fixture. |

