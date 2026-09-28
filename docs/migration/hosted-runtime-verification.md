# Hosted runtime verification

## 2026-09-27 read-only public browser pass

Target: [https://yum-review.vercel.app/](https://yum-review.vercel.app/)

Method: direct browser interaction through CUA in the Codex In-app Browser. The browser inventory exposed the hosted tab and the page accessibility tree. No explicit viewport dimensions were available. Results apply only to the guest session and observed viewport.

### Observed results

- The home page rendered `72 등록 메뉴` and `72 개 메뉴` and showed guest login/signup links.
- Searching `곰라면` and applying the filter produced one visible result, 곰포차 죽전점 곰라면 at 3,900원, with the URL query `q=곰라면`.
- Selecting Korean cuisine and applying added `category=KOREAN`; the combined search/category result count was zero. Selecting 죽전 added `region=죽전`.
- Selecting `맛 평점순` added `sort=taste`. Selecting `1km` added `radius=1000`. These control and URL transitions were observed, but rank/distance semantics were not established because the combined active filters returned no results.
- `필터 초기화` restored `/`, blank search, and default selector values.
- Clicking `장소 찾기` with an empty field displayed `장소 이름이나 주소를 입력해 주세요.` No external place lookup was submitted.
- `/menus/2` rendered 곰라면, 3,900원, four unreviewed rating values, and zero reviews. The review CTA routed a guest to `/login?next=%2Fmenus%2F2`.
- The restaurant link opened `/restaurants/1`, showing 곰포차 죽전점, 죽전, and its menu list.
- Clicking the home personal-review filter as a guest routed to `/login?next=%2F`.
- Submitting the login and signup forms empty showed browser-required-field feedback `이 입력란을 작성하세요.` No account was created.

### Scope and limits

This pass was strictly read-only. No sign-in, account creation, review, like, favorite, upload, mutating request, hosted setting change, or hosted database write was performed. Hosted data was not edited.

The following remain unverified: authenticated member, owner and server-admin flows; review and favorite mutations; successful media upload; successful Naver place lookup; ranking across non-empty multi-menu results; exact viewport/responsive coverage; and any write-path server errors. The full UI QA matrix and Task 09 therefore remain PARTIAL. Detailed per-control evidence is in [ui-qa-matrix.md](ui-qa-matrix.md).
