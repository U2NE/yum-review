# Yum Review — 메뉴 리뷰 MVP 구현 계획

**기준 사양:** `.planning/phases/01-menu-review-mvp/SPEC.md` (2026-09-25 승인)

## Must-haves

- 리뷰 대상은 메뉴다. 식당 정보에는 식당 평균이나 식당 리뷰를 저장하거나 노출하지 않는다.
- 공개 탐색은 홈 검색, 식당 상세, 메뉴 상세와 리뷰 목록을 포함한다. 검색은 메뉴명과 식당명을 대상으로 한다.
- 이메일 가입·로그인·로그아웃은 Spring Security 서버 세션을 사용한다. 비밀번호는 `PasswordEncoder`로 해시하고 공개 응답에 이메일을 싣지 않는다. 변경 요청에는 CSRF 토큰이 필요하다.
- 로그인 사용자만 전체·맛·가성비·양 1–5점과 선택 코멘트(최대 1,000자)를 작성한다. 본인 리뷰만 수정·삭제하며 사용자·메뉴 조합에는 DB 고유 제약을 둔다.
- 메뉴 평균과 리뷰 수는 저장된 리뷰로부터 조회할 때 계산한다. 삭제와 수정 뒤 다음 조회에 즉시 반영된다.
- API 인증 실패와 검증 실패는 JSON으로 응답한다. 임의 출처 허용 CORS를 사용하지 않으며 Vite `/api` 프록시로 개발한다.
- 시드 카탈로그는 허구의 시연용 식당·메뉴임을 화면과 문서에 표시한다. 로컬 PostgreSQL은 Docker Compose로 실행한다.
- 한국어 반응형 화면에 검색 결과 없음, 리뷰 없음, 로딩, 인증 필요, 권한 거부, 저장 실패 상태를 제공한다.

## API 계약

공개: `GET /api/menus?q=&sort=popular|rating` (기본값 `popular`), `GET /api/restaurants/{id}`, `GET /api/menus/{id}`, `GET /api/menus/{id}/reviews`. `popular`는 리뷰 수 내림차순, 평균 별점 내림차순, ID 오름차순이다. `rating`은 평균 별점 내림차순, 리뷰 수 내림차순, ID 오름차순이며 리뷰 없는 메뉴는 뒤에 둔다.

인증: `GET /api/auth/csrf`, `GET /api/auth/me`, `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`.

로그인 계약: 가입은 JSON으로 받고, 로그인은 Spring Security `formLogin` 필터가 `/api/auth/login`에서 `application/x-www-form-urlencoded` 본문 `email=<encoded>&password=<encoded>`를 받는다(`usernameParameter("email")`). 성공·실패 핸들러는 JSON 상태를 반환한다. 프레임워크가 인증 컨텍스트 저장과 세션 ID 변경을 맡는다. 로그아웃은 Spring Security 로그아웃 필터가 `/api/auth/logout`을 처리하고 JSON 성공 응답을 반환한다. 로그인·로그아웃 요청에도 CSRF 헤더를 붙인다.

CSRF 계약: 서버는 세션에 연결된 CSRF 토큰을 사용하고 `GET /api/auth/csrf`에서 지연 생성된 토큰을 실제로 읽어 `{ "headerName": "X-CSRF-TOKEN", "token": "..." }` JSON으로 반환한다. 프런트엔드는 `credentials: "include"`로 이 값을 받아 변경 요청의 해당 헤더에 전송한다. 가입·로그인·로그아웃 후에는 토큰을 다시 받아 갱신한다. Spring Security의 지연 토큰·XOR 처리와 응답/요청 토큰 형식을 함께 확인하고, CSRF 누락·만료와 비로그인 API 호출은 HTML 리다이렉트 없이 JSON 403·401로 끝낸다.

리뷰: `POST /api/menus/{id}/reviews`, `PUT /api/reviews/{id}`, `DELETE /api/reviews/{id}`, `GET /api/me/reviews`.

모든 화면과 API 작업은 이 계약을 공유한다. 공개 메뉴 DTO에는 메뉴별 평균·리뷰 수를 포함하고, 공개 리뷰 DTO에는 작성자 이메일과 비밀번호 관련 값을 포함하지 않는다.

## 실행 원칙

저장소 루트 기준 경로다. 각 작업의 `files_modified` 외 파일을 수정해야 하면 리드가 소유권과 의존성을 먼저 갱신한다. 같은 파일을 쓰는 `05-public-ui → 06-account-ui → 07-review-ui`는 순차 실행한다. `02-catalog-api`와 `03-auth-api`는 기반 작업 후 독립된 Java 파일을 소유하며 병렬 실행한다. 각 작업은 `git diff --check`만 실행하고, 두 작업이 모두 끝난 뒤 리드가 Maven package 명령을 한 번 실행해 통합 컴파일을 확인한다. 같은 `backend/target`을 대상으로 병렬 Maven 빌드를 실행하지 않는다.

<!-- hybrid-plan:v1
{
  "schema": "yum-review-plan/v1",
  "must_haves": [
    "menu-level review and aggregates only; no restaurant score",
    "public search and restaurant/menu detail",
    "session authentication, CSRF, password hashing, JSON API failures",
    "owner-only review CRUD, 1–5 validation, optional 1000-character comment, database unique user/menu pair",
    "PostgreSQL/Flyway persistence with clearly fictional catalog seed",
    "Korean responsive UI with loading, empty, unauthorized and save-error states"
  ],
  "tasks": [
    {
      "id": "01-foundation",
      "goal": "Create the runnable Spring Boot 4.1.x / Java 25 foundation, PostgreSQL Compose service, Flyway schema and fictional demo catalog. Use the Maven Wrapper only-script form so no system Maven is needed.",
      "owner": "backend-foundation-implementer",
      "depends_on": [],
      "files_modified": [
        ".gitignore",
        ".env.example",
        "compose.yaml",
        "backend/pom.xml",
        "backend/mvnw",
        "backend/mvnw.cmd",
        "backend/.mvn/wrapper/maven-wrapper.properties",
        "backend/src/main/java/com/yumreview/YumReviewApplication.java",
        "backend/src/main/resources/application.yml",
        "backend/src/main/resources/db/migration/V1__create_schema.sql",
        "backend/src/main/resources/db/migration/V2__seed_demo_catalog.sql"
      ],
      "acceptance_criteria": [
        "Pinned Spring Boot 4.1.x dependencies explicitly include spring-boot-starter-webmvc (Boot 4 MVC artifact), spring-boot-starter-security, spring-boot-starter-data-jpa, spring-boot-starter-validation, flyway-core, org.flywaydb:flyway-database-postgresql and PostgreSQL JDBC; Java target is 25.",
        "V1 creates users, restaurants, menus and reviews with foreign keys, score CHECK constraints, comment length limit, normalized-email uniqueness and unique(user_id, menu_id).",
        "V2 inserts clearly fictional restaurants and menus without real-user records or fixed review aggregates; it can run once under Flyway.",
        "Compose and application configuration take database credentials from local environment with documented example defaults; no secret is committed.",
        "Wrapper builds the project without Maven on PATH."
      ],
      "verify": "docker compose config --quiet; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Push-Location backend; try { .\\mvnw.cmd -q -DskipTests package; exit $LASTEXITCODE } finally { Pop-Location }"
    },
    {
      "id": "02-catalog-api",
      "goal": "Implement the first public vertical slice: search, restaurant detail, menu detail and public reviews with DB-derived menu averages/counts.",
      "owner": "catalog-api-implementer",
      "depends_on": ["01-foundation"],
      "files_modified": [
        "backend/src/main/java/com/yumreview/catalog/Restaurant.java",
        "backend/src/main/java/com/yumreview/catalog/Menu.java",
        "backend/src/main/java/com/yumreview/catalog/RestaurantRepository.java",
        "backend/src/main/java/com/yumreview/catalog/MenuRepository.java",
        "backend/src/main/java/com/yumreview/catalog/PublicReviewReadRepository.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogDtos.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogService.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogController.java"
      ],
      "acceptance_criteria": [
        "All four public GET routes in the API contract work without a session; menu-name and restaurant-name queries both return menu cards with restaurant context.",
        "PublicReviewReadRepository uses native SQL/projections against the V1 `review` table for public review lists and overall/taste/value/portion averages plus count; Task 02 does not import or depend on Task 04's future Review entity.",
        "Menu response reports overall, taste, value and portion averages and count from persisted reviews; no restaurant aggregate exists.",
        "Empty search and unknown IDs return stable empty or JSON 404 responses; public review data excludes account email.",
        "sort=popular defaults to review count descending, average descending, ID ascending; sort=rating uses average descending, review count descending, ID ascending, with unrated menus last."
      ],
      "verify": "git diff --check"
    },
    {
      "id": "03-auth-api",
      "goal": "Implement JSON session authentication and CSRF flow while protecting write routes and personal data.",
      "owner": "auth-api-implementer",
      "depends_on": ["01-foundation"],
      "security_relevant": true,
      "files_modified": [
        "backend/src/main/java/com/yumreview/auth/AppUser.java",
        "backend/src/main/java/com/yumreview/auth/AppUserRepository.java",
        "backend/src/main/java/com/yumreview/auth/AuthDtos.java",
        "backend/src/main/java/com/yumreview/auth/AuthService.java",
        "backend/src/main/java/com/yumreview/auth/AuthController.java",
        "backend/src/main/java/com/yumreview/auth/SecurityConfig.java",
        "backend/src/main/java/com/yumreview/api/ApiExceptionHandler.java",
        "backend/src/main/resources/application.yml",
        "backend/src/main/resources/application-prod.yml"
      ],
      "acceptance_criteria": [
        "Signup normalizes email, rejects duplicates, hashes passwords through PasswordEncoder and never returns password hashes; BCrypt-backed signup and login reject passwords over 72 UTF-8 bytes rather than accepting an ambiguous/truncated credential.",
        "Spring Security formLogin handles POST /api/auth/login with application/x-www-form-urlencoded email/password and JSON success/failure handlers; its filter persists SecurityContext and rotates the session ID. Do not authenticate manually in AuthController. Spring Security logout handles POST /api/auth/logout with a JSON success handler and invalidates the session; /api/auth/me reports only the current user.",
        "GET /api/auth/csrf materializes Spring Security's deferred session CSRF token and returns headerName/token JSON; the exact returned token is accepted in that header on unsafe requests, including signup, login and logout; clients refetch after authentication transitions.",
        "The CSRF request handler correctly supports Spring Security's deferred/XOR token representation; missing/expired token produces JSON 403.",
        "Credentialed API calls without a session return JSON 401 rather than a login redirect; forbidden and invalid input responses are JSON with meaningful status codes; public GET routes remain accessible; no wildcard CORS is configured.",
        "Session cookies are HttpOnly and SameSite=Lax locally; `application-prod.yml` enables Secure for HTTPS deployment."
      ],
      "verify": "git diff --check"
    },
    {
      "id": "04-review-api",
      "goal": "Add owner-only review creation, update, deletion and my-reviews API against the database constraints.",
      "owner": "review-api-implementer",
      "depends_on": ["02-catalog-api", "03-auth-api"],
      "security_relevant": true,
      "files_modified": [
        "backend/src/main/java/com/yumreview/review/Review.java",
        "backend/src/main/java/com/yumreview/review/ReviewRepository.java",
        "backend/src/main/java/com/yumreview/review/ReviewDtos.java",
        "backend/src/main/java/com/yumreview/review/ReviewService.java",
        "backend/src/main/java/com/yumreview/review/ReviewController.java"
      ],
      "acceptance_criteria": [
        "Create/update validate each score as 1–5 and optional comment as at most 1,000 characters; invalid input returns JSON 400.",
        "Create takes the author only from the authenticated principal; update/delete compare it to persisted ownership before changing a record. A DB integrity error is reported as a duplicate only when the named user/menu unique constraint is the violated constraint; other failures use a safe generic response.",
        "A duplicate user/menu review, including a concurrent attempt, is blocked by the DB unique constraint and returns JSON 409; foreign-key failures do not expose SQL details.",
        "My reviews returns only the signed-in user's records; after create/update/delete, catalog and menu ratings read current DB-derived aggregates."
      ],
      "verify": "Push-Location backend; try { .\\mvnw.cmd -q -DskipTests package; exit $LASTEXITCODE } finally { Pop-Location }"
    },
    {
      "id": "05-public-ui",
      "goal": "Build the responsive Korean public web slice on React, TypeScript and Vite with homepage search and restaurant/menu details.",
      "owner": "public-ui-implementer",
      "depends_on": ["02-catalog-api"],
      "files_modified": [
        "frontend/package.json",
        "frontend/package-lock.json",
        "frontend/tsconfig.json",
        "frontend/vite.config.ts",
        "frontend/index.html",
        "frontend/src/main.tsx",
        "frontend/src/App.tsx",
        "frontend/src/api/client.ts",
        "frontend/src/api/catalog.ts",
        "frontend/src/types.ts",
        "frontend/src/pages/HomePage.tsx",
        "frontend/src/pages/RestaurantPage.tsx",
        "frontend/src/pages/MenuPage.tsx",
        "frontend/src/app.css"
      ],
      "acceptance_criteria": [
        "Vite proxies /api to local Spring Boot and the shared API client sends same-origin credentials; unsafe requests fetch /api/auth/csrf as needed and attach its returned headerName/token.",
        "Home search finds menus by name or restaurant and shows menu cards, average and review count; a visible selector switches Recommended/popular and Rating order, defaulting to Recommended; restaurant page shows its menus and no restaurant rating.",
        "Menu page shows all four menu-level averages and public review list without email; the catalog is visibly marked fictional demo data.",
        "Responsive Korean screens show loading, empty-search, empty-review and request-error states; route refresh works in Vite."
      ],
      "verify": "npm --prefix frontend ci; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm --prefix frontend run build; exit $LASTEXITCODE"
    },
    {
      "id": "06-account-ui",
      "goal": "Connect the account routes and session state to the public UI, with accessible Korean signup/login/logout flows.",
      "owner": "account-ui-implementer",
      "depends_on": ["03-auth-api", "05-public-ui"],
      "security_relevant": true,
      "files_modified": [
        "frontend/src/App.tsx",
        "frontend/src/app.css",
        "frontend/src/api/client.ts",
        "frontend/src/api/auth.ts",
        "frontend/src/auth/AuthContext.tsx",
        "frontend/src/pages/LoginPage.tsx",
        "frontend/src/pages/SignupPage.tsx"
      ],
      "acceptance_criteria": [
        "Signup uses JSON; login encodes email/password as application/x-www-form-urlencoded for Spring Security formLogin. Both preserve session cookies, send the /api/auth/csrf headerName/token for unsafe requests, refresh it after signup/login/logout, and refresh current-user state on reload.",
        "Logout clears client state and server session; gated navigation returns to login after session expiry.",
        "Forms show validation, duplicate email, login failure and network errors without leaking credentials or sensitive server text."
      ],
      "verify": "npm --prefix frontend run build; exit $LASTEXITCODE"
    },
    {
      "id": "07-review-ui",
      "goal": "Complete the menu review vertical slice and my-reviews view with create, edit, delete and visible aggregate refresh.",
      "owner": "review-ui-implementer",
      "depends_on": ["04-review-api", "06-account-ui"],
      "files_modified": [
        "frontend/src/App.tsx",
        "frontend/src/app.css",
        "frontend/src/api/reviews.ts",
        "frontend/src/components/ReviewForm.tsx",
        "frontend/src/pages/MenuPage.tsx",
        "frontend/src/pages/MyReviewsPage.tsx"
      ],
      "acceptance_criteria": [
        "Logged-in users can create one review per menu, edit their review and delete it; other users' reviews have no edit/delete actions.",
        "Form captures overall, taste, value, portion (1–5 each) and optional 1,000-character comment; invalid input and save failures are explained in Korean.",
        "Successful mutations refresh the menu's averages, count and list without stale cached values; my-reviews lists only the current user's items.",
        "Guest review entry leads to login; session expiry, permission denial and duplicate review conflicts have clear states."
      ],
      "verify": "npm --prefix frontend run build; exit $LASTEXITCODE"
    },
    {
      "id": "08-local-run-guide",
      "goal": "Document reproducible local setup and perform the final integration handoff, including the Docker-engine limitation observed during planning.",
      "owner": "integration-implementer",
      "depends_on": ["04-review-api", "07-review-ui"],
      "files_modified": ["README.md"],
      "acceptance_criteria": [
        "README lists Java 25, Node 24, Docker Desktop, environment setup, Compose database start, backend wrapper command and frontend Vite command in order.",
        "README identifies the catalog as fictional sample data and explains the menu-only review scope and session/CSRF local behavior.",
        "Backend package, frontend build and Compose config commands pass; when Docker engine is available, the documented browser/API flow confirms persistence, ownership, duplicate handling and aggregate refresh.",
        "If the Docker engine remains unavailable, report that specific runtime verification gap with the completed build evidence."
      ],
      "verify": "docker compose config --quiet; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Push-Location backend; try { .\\mvnw.cmd -q -DskipTests package; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }; npm --prefix frontend run build; exit $LASTEXITCODE"
    }
  ]
}
-->

## 실행 파동

1. `01-foundation`
2. `02-catalog-api`, `03-auth-api` — Java 소스 경로가 겹치지 않는다. 통합 빌드는 둘 다 완료한 뒤 실행한다.
3. `04-review-api`, `05-public-ui` — 리뷰 API와 공개 화면은 서로 다른 경로를 쓴다.
4. `06-account-ui`
5. `07-review-ui`
6. `08-local-run-guide`

## 통합 컴파일 게이트

Wave 2의 `02-catalog-api`와 `03-auth-api`가 모두 끝나면 리드가 프로젝트 루트에서 아래 명령을 한 번 실행한다. 각 작업의 `git diff --check`는 병렬로 실행 가능하며 Maven 빌드는 통합 게이트에서만 실행한다.

```powershell
Push-Location backend
try { .\mvnw.cmd -q -DskipTests compile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
finally { Pop-Location }
```

## 최종 검토

구현자와 별도로 인증·CSRF 지연/XOR 토큰 흐름·로그인 리다이렉트 없는 JSON 401/403·리뷰 소유권·공개 응답의 개인정보·DB 중복 제약을 보안 관점에서 검토한다. 마지막에는 계획의 각 수용 기준을 실제 API와 화면에 대조한다. 현재 Docker Desktop 엔진이 연결되지 않아 Compose 구문 검사는 가능하지만 DB를 띄운 실행 확인은 엔진이 준비되면 수행한다.
