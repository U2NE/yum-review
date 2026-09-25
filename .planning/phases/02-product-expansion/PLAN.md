# Yum Review — 승인 사양 구현 계획

**기준 사양:** `.planning/phases/02-product-expansion/SPEC.md` — 사용자 승인 완료, 2026-09-25
**계획 유형:** Hybrid Tier 3 / 고위험 — 보안 경계, 기존 데이터 삭제, 파일 업로드, 다중 모듈 UI/API 변경
**계획 원칙:** 구현 중인 코드를 먼저 만들고 사용자 데이터로 QA하지 않는다. 승인된 범위에서 이 계획과 독립 검증이 끝난 뒤 통합한다.

<!-- hybrid-plan:v1
{
  "tier": 3,
  "highRisk": true,
  "must_haves": [
    "Server authority is enforced on every catalog and review mutation, with restaurant-scoped owners and a one-time local server-admin bootstrap.",
    "Review values accept only 0.5–5.0 in 0.5 increments, require the event-free checkbox, and aggregate to actual arithmetic averages.",
    "Each uploaded image is rejected at 100 MB or above; images above 10 MB are optimized toward 10 MB without making 10 MB a hard limit.",
    "Cuisine, region, distance radius, all rating dimensions, and review-count sorting work together; place-search results and coordinates are not persisted.",
    "Only verified Jukjeon business/menu facts from permitted, traceable sources are seeded; no NAVER Local API output or unlicensed NAVER-posted photo is stored or rehosted.",
    "The V2 fictional catalog and only its fixture-linked QA reviews are removed; real users and unrelated verified reviews remain.",
    "The Korean responsive UI uses real content hierarchy and a bespoke editorial visual system rather than generic AI-style patterns."
  ],
  "principles": [
    "Server authorization is the source of truth; hiding a control in React is never treated as access control.",
    "Preserve existing accounts, real reviews, and history; destructive cleanup must match the exact known V2 fixture records.",
    "Persist only data the product is allowed to retain; use NAVER place search as an ephemeral user-selection aid and never copy user-posted photos without permission.",
    "Use one exact score representation and one image validation/optimization path across all entry points.",
    "Every migration, permission decision, and failure path must have a repeatable automated verification and an inspectable result."
  ],
  "decisionDrivers": [
    "High-impact trust boundaries: server-admin power, restaurant ownership, CSRF/session authentication, review deletion, and untrusted image bytes.",
    "Existing V1/V2 data must remain usable and real user/review rows must survive the upgrade.",
    "Search and ranking need to combine SQL-derived aggregates with cuisine, region, radius, and deterministic tie-breaking.",
    "The user approved a local-development product and local-disk image storage, while photos and third-party place data have explicit retention limits.",
    "All thirteen approved SPEC acceptance criteria must be traceable to owned implementation tasks and automated or visual verification."
  ],
  "viableOptions": [
    {
      "name": "Append-only PostgreSQL migration with exact fixture matching",
      "tradeoffs": "Requires careful upgrade tests and explicit predicates; keeps Flyway history immutable and protects unrelated real rows."
    },
    {
      "name": "Rewrite V1/V2 and rebuild the local database",
      "tradeoffs": "Simpler apparent schema but destroys migration history and risks deleting real user data; rejected for this already-used database."
    },
    {
      "name": "Persist scores as NUMERIC(2,1) with database checks",
      "tradeoffs": "Readable exact half-point values and SQL averages; a few entity/DTO conversions change from integer to decimal."
    },
    {
      "name": "Persist scores as integer half-units (1 means 0.5 stars)",
      "tradeoffs": "Simple integer validation but every response, aggregate, sort, and display needs a scale conversion; rejected to avoid split semantics."
    },
    {
      "name": "Local disk for optimized image bytes, PostgreSQL for opaque metadata and associations",
      "tradeoffs": "Fits local development and avoids database bloat; deployment portability and backup coordination are weaker than object storage, which is out of scope."
    },
    {
      "name": "Store photo bytes in PostgreSQL or rehost source-site images",
      "tradeoffs": "Would simplify deployment but inflate database backups or violate the approved photo-rights/data-retention boundary; rejected."
    }
  ],
  "alternativeInvalidationRationale": "The listed alternatives cover migration/data safety, exact score representation, and image storage; the rejected choices either risk real user data or add prohibited retention and maintenance costs for this local MVP.",
  "adr": {
    "decision": "Append V3/V4 migrations with allowlisted QA-only fixture review cleanup and fail-closed preflight; one dependency task owns the POM; roles and first-login credential rotation are enforced by Spring; half-stars use NUMERIC(2,1); single-file uploads use bounded local storage with rights metadata and post-commit cleanup/retry; E2E runs against an isolated disposable Compose DB.",
    "drivers": [
      "Protect real data and refuse ambiguous review deletion.",
      "Enforce role scope, CSRF and first-login credential change in the backend.",
      "Bound upload byte/concurrency/temp resources and preserve rights/provenance.",
      "Make E2E repeatable on the host without touching the dev database.",
      "Avoid empty or invented catalog seed success."
    ],
    "alternatives": [
      "Delete every review for fake menus: rejected; author may be non-QA.",
      "Rewrite prior migrations/reset DB: rejected; risks real data.",
      "Five-photo multipart and unbounded parallel processing: rejected; large request/resource spike.",
      "Startup stdout password: rejected; may be captured persistently; lead supplies process env and hands secret to user in chat.",
      "Synchronous pre-commit file deletion: rejected; conflicts with transaction rollback; mark unavailable then clean after commit/retry."
    ],
    "whyChosen": "The plan protects unknown data by refusing to guess, makes one-file uploads and filesystem cleanup bounded/recoverable, and uses explicitly disposable databases/processes for reproducible verification.",
    "consequences": [
      "V3 deletes only allowlisted QA reviews and aborts before deletion on unknown/non-QA fixture-linked reviews.",
      "Lead-generated bootstrap credential is supplied via env and shared to user once; server stores only hash and forces password rotation on first login.",
      "Uploader/source/rights/status metadata controls serving; detach/replacement/delete commits unavailable state then queues cleanup and retry.",
      "POM has one dependency-task owner; test setup can use Testcontainers or explicitly supplied disposable host DB.",
      "QA seed needs nonempty verified evidence or task remains blocked."
    ],
    "followUps": [
      "Keep .env/API credentials local and out of Git; place search credentials only in server environment variables.",
      "If a rights holder supplies photos, record permission/source in the catalog source ledger before seeding or uploading them.",
      "If deployment or multiple app instances are later requested, migrate local media to a managed object store and add backup/retention policy as a separate approved phase."
    ]
  },
  "preMortem": [
    {
      "scenario": "Migration removes non-QA or unknown reviews associated with fictional menus.",
      "likelihood": "medium",
      "impact": "critical",
      "prevention": "Preflight exact V2 fixture content and QA author allowlist before deletion; abort on any changed/extra fixture data or unknown/non-QA author; delete only explicit QA rows.",
      "signal": "Success test removes allowlisted QA rows while preserving unrelated rows; failure tests for unknown authors and altered/extra fixture rows prove complete rollback."
    },
    {
      "scenario": "An owner mutates another restaurant or the bootstrap admin stays on the temporary password.",
      "likelihood": "medium",
      "impact": "critical",
      "prevention": "Central server-side owner checks plus mustChangePassword enforcement on every protected mutation; route guard reads current-user profile.",
      "signal": "Role matrix integration tests and first-login restart tests verify 401/403, forced form, old-password rejection and persisted password change."
    },
    {
      "scenario": "Image upload fills disk/memory or leaves a public orphan after rollback/deletion.",
      "likelihood": "medium",
      "impact": "high",
      "prevention": "Single-file requests, byte/pixel limits, bounded concurrency, disk-backed temp, mandatory rights metadata, immediate pending-delete denial, after-commit cleanup retry and aged orphan reconciliation.",
      "signal": "Test exact size boundary, disk-full, abort, temp cleanup, no serving after unlink, retry success and orphan sweep."
    },
    {
      "scenario": "E2E uses the persistent development DB or leaves servers running.",
      "likelihood": "medium",
      "impact": "high",
      "prevention": "Unique dedicated Compose project/volume, port checks, bounded health waits and finally kills child process trees plus QA project only.",
      "signal": "Run the same host script twice and assert both runs pass while dev database and ports are unchanged."
    },
    {
      "scenario": "Verified catalog seed silently contains zero rows or uncertain/unauthorized content.",
      "likelihood": "medium",
      "impact": "high",
      "prevention": "Require at least one sourced restaurant/menu or explicitly block the seed task; ledger all stored facts and never retain NAVER Local API output/user photos.",
      "signal": "Seed verification fails on zero rows and audits each row against dated source evidence."
    },
    {
      "scenario": "An uploaded image ID is attached to another user's review or reused across reviews.",
      "likelihood": "medium",
      "impact": "high",
      "prevention": "Photo attach/detach resolves authenticated uploader, review owner, active lifecycle state, and existing unique association in the same server transaction.",
      "signal": "Direct API and browser tests reject cross-user, inactive, and already-associated media IDs."
    }
  ],
  "testStrategy": {
    "unit": [
      "Half-step validation and average math; stable null-last sorting; category/region normalization; Haversine boundary math.",
      "Image signature/bytes/pixels, rights attestation, single-file upload, concurrency, optimization target, after-commit revocation, idempotent retry and orphan grace-period cleanup."
    ],
    "integration": [
      "Spring Boot test + Testcontainers PostgreSQL, with optional external disposable IT_DB_URL for host-run QA; upgrade V2 to current schema with real sentinel rows.",
      "Allowlisted QA fixture review is deleted; unknown/non-QA fixture review aborts and rolls back every migration statement; unrelated accounts and reviews survive.",
      "Test admin bootstrap create/restart/no-reset/missing-secret fail-closed, first-login password reset, CSRF, all owner/admin routes and scores/consent.",
      "Test media uploader/source/rights and detach/delete/replacement availability, cleanup after commit, filesystem failure/retry, disk-full/incomplete/temp cleanup, size boundary and concurrency.",
      "Test nonempty source-ledger-backed seed or task marked blocked; verify ephemeral location search and combined sorts/filters."
    ],
    "e2e": [
      "Run `scripts/run-qa-e2e.ps1`: isolated uniquely named Compose DB on 55432; API 18081; Vite 5174; DB health and `/api/auth/csrf` and `/` readiness waits; finally terminate process trees and remove only its QA project/volume.",
      "Playwright covers first-login password change, role/current-user API context, guest discovery, every sort/filter, URL restoration and browser navigation, review consent/half-stars/photos, media delete/replacement, cross-user/media-reuse denial, owner management and server-admin review deletion/direct denied requests.",
      "Capture 360/768/1440 px and keyboard/focus/loading/empty/error states; repeat runner twice to verify clean startup/teardown."
    ],
    "observability": [
      "No passwords/bootstrap secrets/session values/image bytes or names/search terms/precise coordinates in logs. Admin events use actor/target IDs; media logs operation ID/byte counts/status/retry count only.",
      "Record DB health, migration version, upload temp/storage writability, key-missing fallback, post-commit cleanup outcome and process cleanup status in QA.md."
    ]
  },
  "spec_acceptance_criteria": [
    "서버 관리자와 업주 관리자는 서로 다른 권한을 가지며, 우회 API 요청에도 서버가 권한을 강제한다.",
    "업주가 다른 식당의 메뉴를 변경하거나 리뷰를 삭제하면 거부된다. 서버 관리자만 어느 식당의 메뉴와 리뷰에도 관리 조치를 할 수 있다.",
    "메뉴 등록·수정·삭제 뒤 공개 메뉴 탐색과 평점/리뷰 집계가 갱신된다.",
    "전체·맛·가성비·양·리뷰 수 정렬을 각각 선택할 수 있으며 필터와 결합된다.",
    "리뷰 이벤트 비참여 동의 없이 리뷰는 저장되지 않고, 저장된 동의 상태를 다시 조회할 수 있다.",
    "권리 확인된 대표 메뉴 사진과 리뷰 사진을 업로드·표시하고, 잘못된 파일을 거부하며 100MB 이상 이미지를 차단한다. 10MB 초과 이미지는 자동 최적화를 시도한다.",
    "음식 종류, 지역, 선택 반경을 조합해 검색할 수 있고, 지정한 좌표에서 거리를 미터 단위로 계산한다.",
    "기존 테스트용 가짜 메뉴와 이에만 연결된 QA 리뷰가 데이터베이스에서 제거된다. 실제 계정과 검증된 리뷰는 보존된다.",
    "초기 실매장 자료는 단국대 죽전 근처의 검증된 식당·술집만 포함한다. 확인하지 않은 메뉴 가격·사진·좌표를 사실처럼 넣지 않는다.",
    "새 디자인은 조사 원칙에 따라 실제 음식 사진과 정보의 위계를 살리고 한국어 모바일/데스크톱을 모두 지원하며, 반복형 범용 AI 화면 패턴을 사용하지 않는다.",
    "기존 사용자와 실제 리뷰는 보존하고 모든 스키마 변경은 새 Flyway migration으로 적용한다.",
    "별점 선택지는 0.5점 간격이며, 입력 옆에 2.5점을 보통으로 보는 안내가 있고 계산값은 실제 리뷰의 산술 평균과 일치한다.",
    "초기 서버 관리자 ID와 무작위 비밀번호를 생성해 사용자에게 전달하며, 비밀번호는 저장소에 기록되지 않는다."
  ],
  "tasks": [
    {
      "id": "00-dependency-foundation",
      "goal": "Add all backend test and image-codec dependencies in the only task that owns the Maven POM.",
      "owner": "backend-dependencies-implementer",
      "depends_on": [],
      "files_modified": [
        "backend/pom.xml"
      ],
      "acceptance_criteria": [
        "Add Spring Boot test support, Testcontainers JUnit/PostgreSQL support and one license-reviewed JPEG/PNG/WebP codec; pin versions compatible with the existing Spring Boot/Java baseline.",
        "This task is the sole owner of backend/pom.xml; no implementation or test task edits the POM."
      ],
      "verify": "Push-Location backend; try { .\\mvnw.cmd -q -DskipTests compile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }; git diff --check"
    },
    {
      "id": "01-schema-and-fixture-cleanup",
      "goal": "Add append-only V3 schema and a transactional, fail-closed cleanup of only explicitly identified QA reviews and the exact V2 fictional catalog.",
      "owner": "backend-schema-implementer",
      "depends_on": [
        "00-dependency-foundation"
      ],
      "files_modified": [
        "backend/src/main/resources/db/migration/V3__roles_half_scores_location_media_and_fixture_cleanup.sql"
      ],
      "acceptance_criteria": [
        "기존 테스트용 가짜 메뉴와 이에만 연결된 QA 리뷰가 데이터베이스에서 제거된다. 실제 계정과 검증된 리뷰는 보존된다.",
        "기존 사용자와 실제 리뷰는 보존하고 모든 스키마 변경은 새 Flyway migration으로 적용한다.",
        "Before any DELETE, V3 identifies the three exact V2 fictional restaurants (가상식당 온기, 상상분식 연구소, 달빛면관) and their six menus; only reviews by explicitly allowlisted QA identities (including qa-ui-20260925@example.invalid) are eligible for deletion.",
        "If any fixture-linked review belongs to a non-QA or unknown author, V3 raises an exception before deletion and rolls back the whole migration; it never deletes all reviews merely because menu_id points at a fixture menu.",
        "Preflight verifies the exact V2 fixture restaurant names, descriptions, addresses and exact six menu names/descriptions/prices before any DELETE; any extra or altered fixture-associated record aborts the entire V3 migration. Tests prove no fixture or unrelated row is partially changed on mismatch.",
        "Historical reviews keep event_free_consent as NULL because no attestation was collected at the time; migration must never backfill legacy consent as true or false. New review writes require an explicit true value.",
        "Add role/owner relation, decimal review scores and constraints, consent/first-login flags, restaurant region/coordinates, cuisine/active/image references, media provenance/lifecycle, and photo associations without modifying V1/V2."
      ],
      "verify": "git diff --check"
    },
    {
      "id": "02-admin-identity-and-authorization",
      "goal": "Implement server/owner authorization, explicit-secret admin bootstrap, and mandatory first-login password rotation.",
      "owner": "auth-admin-implementer",
      "depends_on": [
        "01-schema-and-fixture-cleanup"
      ],
      "security_relevant": true,
      "files_modified": [
        "backend/src/main/java/com/yumreview/auth/AppUser.java",
        "backend/src/main/java/com/yumreview/auth/AppUserRepository.java",
        "backend/src/main/java/com/yumreview/auth/AuthDtos.java",
        "backend/src/main/java/com/yumreview/auth/AuthController.java",
        "backend/src/main/java/com/yumreview/auth/AuthService.java",
        "backend/src/main/java/com/yumreview/auth/SecurityConfig.java",
        "backend/src/main/java/com/yumreview/admin/AdminAuthorizationService.java",
        "backend/src/main/java/com/yumreview/admin/AdminBootstrapRunner.java",
        "backend/src/main/java/com/yumreview/admin/AdminController.java",
        "backend/src/main/java/com/yumreview/admin/AdminDtos.java",
        "backend/src/main/java/com/yumreview/admin/AdminService.java",
        "backend/src/main/java/com/yumreview/admin/RestaurantOwner.java",
        "backend/src/main/java/com/yumreview/admin/RestaurantOwnerRepository.java",
        ".env.example"
      ],
      "acceptance_criteria": [
        "서버 관리자와 업주 관리자는 서로 다른 권한을 가지며, 우회 API 요청에도 서버가 권한을 강제한다.",
        "초기 서버 관리자 ID와 무작위 비밀번호를 생성해 사용자에게 전달하며, 비밀번호는 저장소에 기록되지 않는다.",
        "Only server admins assign/remove restaurant-owner associations; a role alone never authorizes another restaurant. All catalog/review mutations are checked in the backend and retain CSRF/session protections.",
        "The lead generates an explicit high-entropy bootstrap password, supplies email/password via process environment, and delivers the ID/password to the user once in chat; the raw password is never logged or written. If no admin exists and neither explicit env credentials nor an interactive secure handoff is available, bootstrap fails closed before account creation. Existing admins are never reset on restart.",
        "AppUser/current-user API records and returns mustChangePassword; first-login admin can only logout/change password, old password is verified, success clears the DB flag, and restart preserves the changed credential."
      ],
      "verify": "Push-Location backend; try { .\\mvnw.cmd -q -DskipTests compile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }; git diff --check"
    },
    {
      "id": "03-media-storage-and-lifecycle",
      "goal": "Implement rights-aware single-image storage, bounded optimization/resource use, immediate revocation, after-commit cleanup and retry/reconciliation.",
      "owner": "media-backend-implementer",
      "depends_on": [
        "01-schema-and-fixture-cleanup",
        "02-admin-identity-and-authorization"
      ],
      "security_relevant": true,
      "files_modified": [
        "backend/src/main/resources/application.yml",
        "backend/src/main/java/com/yumreview/media/MediaConfiguration.java",
        "backend/src/main/java/com/yumreview/media/StoredImage.java",
        "backend/src/main/java/com/yumreview/media/StoredImageRepository.java",
        "backend/src/main/java/com/yumreview/media/ImageStorageService.java",
        "backend/src/main/java/com/yumreview/media/ImageLifecycleService.java",
        "backend/src/main/java/com/yumreview/media/MediaCleanupScheduler.java",
        "backend/src/main/java/com/yumreview/media/MediaUploadController.java",
        "backend/src/main/java/com/yumreview/media/ImageController.java"
      ],
      "acceptance_criteria": [
        "권리 확인된 대표 메뉴 사진과 리뷰 사진을 업로드·표시하고, 잘못된 파일을 거부하며 100MB 이상 이미지를 차단한다. 10MB 초과 이미지는 자동 최적화를 시도한다.",
        "One image per upload request; reject actual file bytes >=100,000,000, and for valid images >10,000,000 bytes attempt resize/re-encode toward <=10,000,000 without rejecting solely because optimized output remains over target.",
        "Configure Spring multipart limits explicitly so one 100 MB boundary payload plus multipart overhead reaches application validation: max-file-size 101MB and max-request-size 102MB; application logic still rejects actual image bytes >=100,000,000. Configure disk-backed temp storage under the media directory.",
        "Use disk-backed temp streaming, a small bounded concurrent-upload semaphore, stale-temp cleanup, bounded decoded pixels, signature verification, safe 507 disk-full behavior, and guaranteed cleanup of incomplete files.",
        "Persist uploader ID, source/provenance and mandatory rights attestation/time with media lifecycle status; discard original filenames. Attachments enforce one menu photo and up to five separately uploaded review photos.",
        "On detach, replacement or review deletion, mark media unavailable and remove its association in the domain transaction; after commit delete bytes then metadata. Failures remain unavailable/pending and retry safely; reconciliation handles aged orphans without touching active rows.",
        "Image GET returns no bytes once detached/deleted/pending; it accepts only opaque media IDs and checks lifecycle state."
      ],
      "verify": "Push-Location backend; try { .\\mvnw.cmd -q -DskipTests compile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }; git diff --check"
    },
    {
      "id": "04-catalog-admin-and-discovery-api",
      "goal": "Implement authorized menu management, decimal aggregates/ranks, cuisine/region/radius search and ephemeral NAVER location search.",
      "owner": "catalog-backend-implementer",
      "depends_on": [
        "01-schema-and-fixture-cleanup",
        "02-admin-identity-and-authorization",
        "03-media-storage-and-lifecycle"
      ],
      "security_relevant": true,
      "files_modified": [
        "backend/src/main/java/com/yumreview/catalog/Menu.java",
        "backend/src/main/java/com/yumreview/catalog/MenuRepository.java",
        "backend/src/main/java/com/yumreview/catalog/Restaurant.java",
        "backend/src/main/java/com/yumreview/catalog/RestaurantRepository.java",
        "backend/src/main/java/com/yumreview/catalog/PublicReviewReadRepository.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogDtos.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogService.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogController.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogAdminController.java",
        "backend/src/main/java/com/yumreview/catalog/CatalogAdminService.java",
        "backend/src/main/java/com/yumreview/location/LocationSearchController.java",
        "backend/src/main/java/com/yumreview/location/NaverLocalSearchClient.java"
      ],
      "acceptance_criteria": [
        "업주가 다른 식당의 메뉴를 변경하거나 리뷰를 삭제하면 거부된다. 서버 관리자만 어느 식당의 메뉴와 리뷰에도 관리 조치를 할 수 있다.",
        "메뉴 등록·수정·삭제 뒤 공개 메뉴 탐색과 평점/리뷰 집계가 갱신된다.",
        "전체·맛·가성비·양·리뷰 수 정렬을 각각 선택할 수 있으며 필터와 결합된다.",
        "음식 종류, 지역, 선택 반경을 조합해 검색할 수 있고, 지정한 좌표에서 거리를 미터 단위로 계산한다.",
        "Owners can manage menus only for attached restaurants; server admins manage any menu; menu removal is soft/inactive to retain real reviews and computed history.",
        "Scores sort by overall/taste/value/portion or review count, combine with all filters, put unrated last, and use stable ties. Distance supports the approved radii and meter calculation.",
        "Place-search API credentials come from server env only; results/selected coordinates remain transient and are not cached or stored."
      ],
      "verify": "Push-Location backend; try { .\\mvnw.cmd -q -DskipTests compile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }; git diff --check"
    },
    {
      "id": "05-review-scoring-consent-and-admin-api",
      "goal": "Implement half-point review validation, consent persistence, photo attachments and server-admin-only cross-user deletion.",
      "owner": "review-backend-implementer",
      "depends_on": [
        "01-schema-and-fixture-cleanup",
        "02-admin-identity-and-authorization",
        "03-media-storage-and-lifecycle"
      ],
      "security_relevant": true,
      "files_modified": [
        "backend/src/main/java/com/yumreview/review/Review.java",
        "backend/src/main/java/com/yumreview/review/ReviewRepository.java",
        "backend/src/main/java/com/yumreview/review/ReviewDtos.java",
        "backend/src/main/java/com/yumreview/review/ReviewService.java",
        "backend/src/main/java/com/yumreview/review/ReviewController.java"
      ],
      "acceptance_criteria": [
        "리뷰 이벤트 비참여 동의 없이 리뷰는 저장되지 않고, 저장된 동의 상태를 다시 조회할 수 있다.",
        "별점 선택지는 0.5점 간격이며, 입력 옆에 2.5점을 보통으로 보는 안내가 있고 계산값은 실제 리뷰의 산술 평균과 일치한다.",
        "Only decimal values in the 0.5–5.0 half-step set are accepted at API and persistence boundaries; consent false/missing rejects writes; saved consent is returned.",
        "Legacy rows with NULL consent remain readable as an unknown historical state; do not present them as consented. New API writes require explicit true consent.",
        "Regular users edit/delete only their own reviews; restaurant owners cannot delete reviews; server admins can delete any review. Review-photo attach/detach checks review ownership on every request; media must have been uploaded by that user, be active and unattached, and cannot be reused on another review or across associations. One photo per request, max five review-photo associations."
      ],
      "verify": "Push-Location backend; try { .\\mvnw.cmd -q -DskipTests compile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }; git diff --check"
    },
    {
      "id": "06-verified-jukjeon-catalog-seed",
      "goal": "Seed a non-empty set of independently verified Jukjeon businesses and menus, or explicitly block instead of accepting a vacuous seed.",
      "owner": "catalog-data-implementer",
      "depends_on": [
        "01-schema-and-fixture-cleanup"
      ],
      "files_modified": [
        "backend/src/main/resources/db/migration/V4__seed_verified_jukjeon_catalog.sql",
        "docs/jukjeon-catalog-sources.md"
      ],
      "acceptance_criteria": [
        "초기 실매장 자료는 단국대 죽전 근처의 검증된 식당·술집만 포함한다. 확인하지 않은 메뉴 가격·사진·좌표를 사실처럼 넣지 않는다.",
        "Task succeeds only with at least one independently verified local food/beverage business and one menu tied to a dated permitted source-ledger entry; record exact menu/price details only when the merchant-managed source shows them, and otherwise omit unknown fields. If sources/permission cannot support a non-empty set, mark BLOCKED and report the missing evidence rather than passing with zero rows.",
        "Never persist NAVER Local API results or rehost NAVER user photos; unknown prices/addresses/coordinates/photos are omitted, not invented.",
        "V4 is idempotent and seed-specific verification asserts at least one seeded real business and menu are non-empty; latitude/longitude remain NULL until independently verified from a permitted geocoder source."
      ],
      "verify": "git diff --check"
    },
    {
      "id": "07-react-feature-and-bespoke-design",
      "goal": "Integrate role-aware account/admin, password rotation, discovery, reviews/photos and editorial responsive design.",
      "owner": "frontend-product-implementer",
      "depends_on": [
        "02-admin-identity-and-authorization",
        "03-media-storage-and-lifecycle",
        "04-catalog-admin-and-discovery-api",
        "05-review-scoring-consent-and-admin-api"
      ],
      "files_modified": [
        "frontend/src/App.tsx",
        "frontend/src/app.css",
        "frontend/src/api/client.ts",
        "frontend/src/api/auth.ts",
        "frontend/src/api/catalog.ts",
        "frontend/src/api/reviews.ts",
        "frontend/src/api/admin.ts",
        "frontend/src/auth/AuthContext.tsx",
        "frontend/src/types.ts",
        "frontend/src/utils/format.ts",
        "frontend/src/components/ReviewForm.tsx",
        "frontend/src/pages/HomePage.tsx",
        "frontend/src/pages/RestaurantPage.tsx",
        "frontend/src/pages/MenuPage.tsx",
        "frontend/src/pages/MyReviewsPage.tsx",
        "frontend/src/pages/AdminPage.tsx",
        "frontend/src/pages/LoginPage.tsx",
        "frontend/src/pages/SignupPage.tsx",
        "frontend/src/pages/PasswordChangePage.tsx"
      ],
      "acceptance_criteria": [
        "전체·맛·가성비·양·리뷰 수 정렬을 각각 선택할 수 있으며 필터와 결합된다.",
        "새 디자인은 조사 원칙에 따라 실제 음식 사진과 정보의 위계를 살리고 한국어 모바일/데스크톱을 모두 지원하며, 반복형 범용 AI 화면 패턴을 사용하지 않는다.",
        "별점 선택지는 0.5점 간격이며, 입력 옆에 2.5점을 보통으로 보는 안내가 있고 계산값은 실제 리뷰의 산술 평균과 일치한다.",
        "frontend/src/api/auth.ts owns current-user role, owner restaurant IDs and mustChangePassword types; AuthContext loads/exposes this data to nav, menu-admin scope, and route guard.",
        "First-login server admin is redirected to password change; client navigation is guarded, server-required-change errors are handled, and successful change refreshes auth state.",
        "Server-admin screen lets the server admin find a registered user, assign that user as owner of a selected restaurant, and revoke that association; it shows current owner assignments and never exposes this control to owners or ordinary users.",
        "Every image is sent in a separate request; UI blocks >=100,000,000 bytes, displays the 10,000,000-byte optimization target, and refreshes after lifecycle removal.",
        "Search term, cuisine filters, radius, and sort serialize into URL query parameters and restore on direct load and browser back/forward. Exact selected coordinates remain in transient in-memory request state, not URL, DB, logs or persistent browser storage.",
        "The Korean UI emphasizes authentic content, menu/store/region/score hierarchy, mobile filter/review usability, accessible focus, and no generic AI-style decoration. Search term, cuisine, radius and sort query state is restored for direct page loads and back/forward navigation; exact place/device coordinates are never URL or durable storage state."
      ],
      "verify": "npm --prefix frontend run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git diff --check"
    },
    {
      "id": "08-independent-integration-and-browser-qa",
      "goal": "Add PostgreSQL migration/security/media integration coverage and an isolated host-run E2E environment with health waits and process cleanup.",
      "owner": "qa-implementer",
      "depends_on": [
        "00-dependency-foundation",
        "01-schema-and-fixture-cleanup",
        "02-admin-identity-and-authorization",
        "03-media-storage-and-lifecycle",
        "04-catalog-admin-and-discovery-api",
        "05-review-scoring-consent-and-admin-api",
        "07-react-feature-and-bespoke-design"
      ],
      "files_modified": [
        "backend/src/test/resources/application-test.yml",
        "backend/src/test/java/com/yumreview/support/PostgresTestConfiguration.java",
        "backend/src/test/java/com/yumreview/migration/LegacyDataCleanupMigrationTest.java",
        "backend/src/test/java/com/yumreview/admin/AdminAuthorizationIntegrationTest.java",
        "backend/src/test/java/com/yumreview/admin/FirstLoginPasswordChangeIntegrationTest.java",
        "backend/src/test/java/com/yumreview/catalog/CatalogDiscoveryIntegrationTest.java",
        "backend/src/test/java/com/yumreview/catalog/VerifiedSeedDataIntegrationTest.java",
        "backend/src/test/java/com/yumreview/review/ReviewScoreConsentIntegrationTest.java",
        "backend/src/test/java/com/yumreview/media/ImageUploadIntegrationTest.java",
        "backend/src/test/java/com/yumreview/media/ImageLifecycleIntegrationTest.java",
        "compose.qa.yaml",
        "scripts/run-qa-e2e.ps1",
        "frontend/package.json",
        "frontend/package-lock.json",
        "frontend/playwright.config.ts",
        "frontend/e2e/guest-discovery.spec.ts",
        "frontend/e2e/review-consent-and-images.spec.ts",
        "frontend/e2e/admin-owner-permissions.spec.ts",
        "frontend/e2e/first-login-password-change.spec.ts"
      ],
      "acceptance_criteria": [
        "서버 관리자와 업주 관리자는 서로 다른 권한을 가지며, 우회 API 요청에도 서버가 권한을 강제한다.",
        "업주가 다른 식당의 메뉴를 변경하거나 리뷰를 삭제하면 거부된다. 서버 관리자만 어느 식당의 메뉴와 리뷰에도 관리 조치를 할 수 있다.",
        "리뷰 이벤트 비참여 동의 없이 리뷰는 저장되지 않고, 저장된 동의 상태를 다시 조회할 수 있다.",
        "음식 종류, 지역, 선택 반경을 조합해 검색할 수 있고, 지정한 좌표에서 거리를 미터 단위로 계산한다.",
        "기존 테스트용 가짜 메뉴와 이에만 연결된 QA 리뷰가 데이터베이스에서 제거된다. 실제 계정과 검증된 리뷰는 보존된다.",
        "초기 실매장 자료는 단국대 죽전 근처의 검증된 식당·술집만 포함한다. 확인하지 않은 메뉴 가격·사진·좌표를 사실처럼 넣지 않는다.",
        "Migration tests prove known QA review removal, unrelated row preservation, non-QA/unknown fixture review failure, and unexpected/altered V2 fixture rows failure with full rollback and no partial deletes.",
        "Migration tests insert a legacy review with unknown consent and prove it remains NULL after upgrade; a new review without explicit consent remains rejected.",
        "Integration tests verify admin/bootstrap idempotence and absent-secret fail-closed behavior, forced password rotation/restart, roles/CSRF, half-star constraints, consent, filters, media rights and lifecycle.",
        "Integration and browser tests reject photo attach/detach for another user's review, media uploaded by a different user, and an already attached/reused media ID.",
        "E2E signs in as server admin to assign and revoke a restaurant-owner association, verifies it appears/disappears in current-user context, and sends direct assignment requests as owner/ordinary user to prove server-side denial.",
        "E2E asserts search term, cuisine, radius, and sort are represented in URL query state, restore on direct load, and respond to browser back/forward; precise selected coordinates remain only in transient request state.",
        "Playwright keeps a screen-by-screen visible-control checklist for home/discovery, restaurant, menu/review, login, signup, my-reviews, password-change and admin screens; every rendered button, link and form submit is activated by pointer or keyboard and its navigation, state change, validation error or authorization denial is asserted.",
        "Host-run disposable PostgreSQL uses Testcontainers by default; optional IT_DB_URL points only to QA DB at 127.0.0.1:55432, never the user's dev DB.",
        "The runner creates a fresh high-entropy E2E admin password per run in process memory and passes it only through child-process environment to the API and Playwright; it never logs or persists the value, and exercises forced password change.",
        "The runner checks for the Playwright Chromium binary and installs it if missing before E2E; document the network prerequisite and return a clear setup error if installation fails.",
        "scripts/run-qa-e2e.ps1 owns a unique Compose project/database and exact ports 55432/18081/5174; checks ports, waits for DB health and /api/auth/csrf plus Vite /, launches API/Vite hidden with temporary logs, runs Playwright, then finally kills process trees and removes only its QA project/volume. A second run also succeeds.",
        "One upload request contains one photo; tests cover byte boundaries, concurrency cap, stale/incomplete temp cleanup, disk-full behavior, post-commit immediate 404, retry, and orphan reconciliation."
      ],
      "verify": "Push-Location backend; try { .\\mvnw.cmd -q verify; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Pop-Location }; npm --prefix frontend ci; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm --prefix frontend run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; .\\scripts\\run-qa-e2e.ps1"
    },
    {
      "id": "09-local-run-source-and-qa-handoff",
      "goal": "Document safe startup, one-time credential delivery/rotation, media rules, catalog sourcing and QA evidence.",
      "owner": "integration-documentation-implementer",
      "depends_on": [
        "08-independent-integration-and-browser-qa"
      ],
      "files_modified": [
        "README.md",
        ".planning/phases/02-product-expansion/QA.md"
      ],
      "acceptance_criteria": [
        "기존 사용자와 실제 리뷰는 보존하고 모든 스키마 변경은 새 Flyway migration으로 적용한다.",
        "초기 서버 관리자 ID와 무작위 비밀번호를 생성해 사용자에게 전달하며, 비밀번호는 저장소에 기록되지 않는다.",
        "After isolated QA passes, start the local frontend/API against the intended development database, verify both readiness endpoints and exercise the home screen, then provide the user a working localhost link. Never silently fall back to the disposable QA DB for the handoff.",
        "README gives exact host integration-test and `scripts/run-qa-e2e.ps1` commands, Docker/Node/Java requirements, disposable DB, ports, health waits, startup and cleanup behavior without wiping dev data.",
        "Deliver the initial server-admin ID and one-time bootstrap password in the final chat, clearly marked temporary; do not persist it in repository files or logs and require password rotation on first login.",
        "QA.md maps all thirteen SPEC criteria to evidence and states any blocked seed/source or visual/runtime checks honestly."
      ],
      "verify": "node .hybrid/bin/hybrid.mjs validate-plan .planning/phases/02-product-expansion/PLAN.md; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git diff --check"
    }
  ]
}
-->

## Principles

- 백엔드 권한 검사가 최종 기준이다. 화면에서 버튼을 감추는 것만으로 권한을 구현하지 않는다.
- 기존 계정·실제 리뷰·이력은 보존한다. V2 가짜 식당 세 곳/메뉴 여섯 개 리뷰 중 명시적으로 허용한 QA 계정 것만 지우고, 비QA/unknown 작성자 것이면 migration 전체를 중단한다.
- 기록 권한과 출처가 확인된 정보만 보관한다. NAVER 장소 검색은 사용자가 위치를 고르는 동안만 사용하고, 사용자 게시 사진을 권리 확인 없이 복사하지 않는다.
- 별점과 사진 검증 경로를 하나로 유지해 API, DB, 화면 사이의 의미가 달라지지 않게 한다.
- 초기 관리자 비밀번호는 리드가 만든 환경변수 secret을 사용자에게 한 번만 전달하고, 첫 로그인에서 바꾸게 한다. 로그와 파일에는 남기지 않는다.
- 이미지 제거는 DB에서 먼저 즉시 숨기고, 커밋 뒤 파일과 메타데이터를 재시도 가능하게 정리한다.
- 각 데이터 변경과 신뢰 경계는 재현 가능한 자동 검사로 증명한다.

## Decision Drivers

1. 서버 관리자, 식당별 업주, 일반 사용자 사이의 권한 경계, 세션/CSRF 보호, 최초 비밀번호 교체가 중요하다.
2. 이미 적용된 V1/V2의 계정과 실제 리뷰를 유지해야 한다.
3. 지역·종류 필터와 모든 평점 정렬이 일관된 DB 집계와 결합되어야 한다.
4. 사진은 요청당 하나만 받고, 100,000,000 bytes 제한·10,000,000 bytes 목표·권리 출처·커밋 후 회수 수명주기를 지켜야 한다.
5. NAVER 검색 결과나 게시 사진을 옮기지 않으면서 검증 가능한 죽전 매장을 채우며, 근거가 부족하면 seed를 성공 처리하지 않는다.
6. 테스트는 Testcontainers 또는 폐기 가능한 호스트 DB에서, E2E는 자체 실행·정리하는 별도 Compose 프로젝트에서 재현한다.

## Viable Alternatives and Trade-offs

| 결정 | 대안 | 장단점 | 선택 |
|---|---|---|---|
| 스키마 진화 | V1/V2 수정 또는 DB 재생성 | 빠르게 보일 수 있지만 이미 적용된 기록과 사용자 데이터가 손상될 수 있음 | V3/V4 추가 마이그레이션 |
| 반점 점수 저장 | `NUMERIC(2,1)` / 반점 단위 정수 | 소수 컬럼은 SQL에서 읽기 쉽고 정확한 체크 가능 / 정수는 저장 단순하지만 모든 평균과 API에서 변환이 필요 | `NUMERIC(2,1)` |
| 사진 저장 | 로컬 파일+DB 메타데이터 / DB BLOB / 외부 오브젝트 저장소 | 로컬은 MVP 구성이 작지만 다중 인스턴스에는 부적합 / BLOB은 DB 백업을 키움 / 외부 스토리지는 이번 범위보다 큼 | 로컬 파일+opaque 메타데이터 |
| 음식 정보 수집 | 독립 출처·업주 제공 / NAVER Local API 결과 저장 / Naver 게시 사진 복사 | 첫 방식은 기록과 검증을 요구 / 두 번째는 API 결과 보관 제한 / 세 번째는 게시자 권리 침해 위험 | 독립적으로 검증한 허용 정보만 저장 |

## ADR — 데이터·권한·사진 경계

**Decision:** 기존 Spring/PostgreSQL/React를 유지하고 append-only migration을 추가한다. V3는 allowlist에 든 QA 작성자의 가짜 메뉴 리뷰만 지우고, 비QA/unknown 리뷰가 있으면 변경을 롤백한다. Maven POM은 의존성 작업 하나만 소유한다. 서버 권한과 최초 비밀번호 교체를 강제하고 점수는 `NUMERIC(2,1)`로 저장한다. 한 요청에 이미지 한 장씩 올리며 rights/uploader/source를 기록하고, detach 때 즉시 서빙을 끊은 뒤 커밋 후 파일 정리와 retry를 수행한다. NAVER 검색은 일시적 선택에만 사용한다.

**Drivers:** 이미 사용 중인 DB의 데이터 보존, 서버 권한 검증, 전체 경로에서 동일한 평점 정밀도, 로컬 MVP 범위, 제3자 데이터 보관/사진 권리 제한.

**Alternatives:** 기존 migration 수정·DB 초기화(실제 데이터 위험), 가짜 메뉴 리뷰 전체 삭제(실제 작성자일 수 있음), 정수 반점 단위(매 단계 환산), 다중 사진 단일 요청(대형 요청/임시 파일 부담), 로그에 비밀번호 출력(유출 위험), 커밋 전 파일 삭제(롤백 불일치), NAVER 결과·사진 재호스팅(보관/권리 경계 위반)은 거부한다.

**Why chosen:** 한 번의 검증 가능한 점수 표현, 명확한 서버 역할 관계, 제한된 개인정보 저장, 좁은 데이터 정리 범위로 기능을 확장하면서 기존 앱과 데이터를 유지한다.

**Consequences:** 점수 DTO·집계·UI를 함께 바꾼다. 리드가 만든 bootstrap secret은 프로세스 환경으로만 주입하고 채팅에서 사용자에게 한 번 전달한다. E2E 자격증명도 매 실행마다 만들고 프로세스 환경에만 둔다. 사진은 제한된 동시성으로 한 장씩 받고, Spring 요청 한도를 파일 101MB/요청 102MB로 설정해 100MB 경계 파일이 서비스 검증까지 도달하게 한 뒤 실제 바이트가 100,000,000 이상이면 거부한다. 삭제 상태를 commit한 뒤 파일 정리 및 retry한다. 기존 리뷰의 동의 이력은 알 수 없으므로 NULL로 유지한다. 검증 식당·메뉴가 한 개씩도 확인되지 않으면 seed 작업은 blocked로 남긴다.

**Follow-ups:** API 키와 부트스트랩 비밀번호는 저장소에 넣지 않는다. 업주가 사진을 제공하면 출처와 재사용 권한을 ledger에 남긴다. 실제 배포/다중 인스턴스 요청은 별도 승인 후 객체 저장소·백업 정책을 추가한다.

## Deliberate Pre-mortem

1. **실제 리뷰가 정리 migration에서 삭제됨.** 세 가짜 식당/여섯 메뉴에 연결된 리뷰 중 명시적 QA 작성자 외 리뷰가 있으면 V3를 실패시켜 아무 행도 바뀌지 않게 한다. 별도 성공/실패 테스트로 QA 리뷰 정리, unrelated row 보존, unknown 작성자 rollback을 입증한다.
2. **업주가 다른 식당 메뉴나 리뷰를 직접 API로 바꿈.** 역할 UI는 보안이 아니다. 공통 서버 권한 서비스에서 로그인 사용자, 서버 역할, 식당 연결을 확인한다. 익명·일반 회원·다른 식당 업주·해당 업주·서버 관리자별로 모든 쓰기 경로를 통합 검사한다.
3. **대용량/위조 이미지가 메모리나 디스크를 고갈시키거나 삭제된 사진이 계속 공개됨.** 요청당 파일 한 장으로 제한하고, 바이트 수·파일 시그니처·디코더 크기/픽셀·동시성 상한을 검사하며, 임시 파일과 중단 업로드를 정리한다. 사진을 분리하면 DB 상태를 먼저 비공개로 바꾼 뒤 파일을 삭제하고 실패 시 재시도한다. 경계 크기, 위조 MIME, 손상 파일, 동시 업로드, 디스크 부족, orphan 정리와 최적화 실패를 자동화한다.
4. **초기 자료에 권리 없는 사진이나 확인 안 된 가격/좌표가 들어감.** 소스 ledger에서 각 행의 근거를 확인하고, NAVER Local API 결과와 NAVER 사용자 사진은 DB·파일에 넣지 않는다. 정보가 없으면 비워 둔다.
5. **0.5점 입력 일부가 정수로 잘려 정렬/평균이 어긋남.** DTO, 저장, 집계, 화면에 반점 값 0.5/2.5/4.5를 검증하고 비정상 1.2/5.5를 거부한다.

## Verification Strategy

- **Unit:** 점수의 범위·간격과 평균 표시, null-last 안정 정렬, 거리 계산 경계, 이미지 시그니처·크기·픽셀·경로 생성, 10,000,000 bytes 최적화 재시도와 “최적화 뒤 10,000,000 bytes 초과만으로 거부하지 않음”을 단위 검사한다.
- **Integration:** Testcontainers PostgreSQL에서 V1/V2→V3/V4 전체 이행을 실행한다. 마이그레이션 전 실제 데이터 sentinel을 넣고 정리 후 생존을 확인한다. 과거 리뷰의 미수집 동의는 NULL로 보존하고 동의한 것으로 표시되지 않는지 확인한다. 가짜 fixture가 달라졌거나 추가 메뉴가 있으면 전체 롤백하는지 확인한다. CSRF 포함 역할/업주 소유권, 새 리뷰 동의, 점수 제약, 메뉴 숨김, 관리자 리뷰 삭제, 사진을 다른 리뷰/사용자에 연결하거나 중복 연결하려는 시도, 결합 필터·정렬, 일시적 장소 검색, 업로드·이미지 서빙을 검사한다.
- **E2E:** Playwright로 검색, 메뉴 종류/지역/반경, 현재 위치/장소 선택, 모든 정렬, URL 직접 복원과 뒤로/앞으로 이동, 리뷰 동의/반점/사진, 집계 갱신, 서버 관리자의 업주 지정/해제와 업주의 메뉴 관리를 확인한다. 홈/탐색, 식당, 메뉴/리뷰, 로그인, 가입, 내 리뷰, 비밀번호 변경, 관리자 화면에 표시된 모든 버튼·링크·제출 컨트롤을 눌러 화면 이동, 상태 변경, 유효성 오류 또는 권한 거부를 확인한다. 사진의 cross-user 거부와 실제 UI의 리뷰 삭제 버튼도 확인한다. 각 테스트는 격리 QA 환경 안의 임시 계정/레코드만 생성·정리하고 개발 DB를 비우거나 재생성하지 않는다.
- **Observability:** 로컬 구조 로그에는 행위/actor ID/대상 ID, 부트스트랩 상태, 업로드 결과·전후 바이트, 외부 키 설정 상태만 기록한다. 비밀번호·세션·사진 원본명/바이트·검색어·정확한 위치는 기록하지 않는다. 부팅 상태, Flyway 버전, 업로드 디렉터리 쓰기 가능 여부와 키 누락 폴백을 확인해 QA 보고서에 증거를 적는다.
- **Visual QA:** 360/768/1440 px 너비에서 실제 메뉴 콘텐츠 우선순위, 한국어 가독성, 필터와 점수 비교, 포커스 표시, 이미지 없는 상태를 확인한다. 범용 그라데이션 히어로·반복 카드·장식 배지를 피했는지 코드와 화면을 함께 검토한다.

## 실행 순서와 파일 소유권

계획 기계 블록의 `files_modified`가 해당 작업의 유일한 작성 범위다. 한 파일은 목록에 한 작업만 소유한다. 구현 중 공유 파일이 추가로 필요하면 리드가 의존 그래프와 소유권을 먼저 수정한다. 서버 및 Playwright 테스트는 모든 기능이 통합된 후 실행하며, 같은 `backend/target`에 Maven 빌드를 병렬 실행하지 않는다. V3/V4는 적용된 뒤 되돌리지 않고 새 수정 migration으로만 고친다.

1. `00-dependency-foundation`
2. `01-schema-and-fixture-cleanup`
3. `02-admin-identity-and-authorization` 및 `06-verified-jukjeon-catalog-seed` — V3 이후 파일 경로가 분리되어 진행 가능
4. `03-media-storage-and-lifecycle`
5. `04-catalog-admin-and-discovery-api` 및 `05-review-scoring-consent-and-admin-api` — 공통 auth/media 계약을 고정한 뒤 시작하며 seed 완료를 기다리지 않음
6. `07-react-feature-and-bespoke-design` — seed 완료를 기다리지 않음
7. `08-independent-integration-and-browser-qa` — 제품 기능 검증은 seed와 독립 실행하고, seed 자료 자체는 별도 기준으로 결과를 보고
8. `09-local-run-source-and-qa-handoff`

각 작업은 `git diff --check`와 소유 영역의 빌드/검사를 완료하고 결과를 리드에게 넘긴다. 완전한 회귀 검증은 마지막 테스트 파동에서 한 번 실행한다.

## Acceptance Coverage

SPEC의 13개 수용 기준은 machine-readable 계획 안에서 모두 최소 한 개 작업의 acceptance criterion과 정확히 매핑되어 있다. 특히 서버 권한은 작업 02/04/05/07/08, 데이터 보존은 01/08, 반점 점수는 01/05/07/08, 사진은 01/03/05/07/08, 초기 실매장 자료는 06/08에 걸쳐 검증한다.

## Automated Commands

저장소 루트에서 실행한다. Maven integration test는 전용 Testcontainers PostgreSQL을 사용하고, 개발 Compose 볼륨을 지우지 않는다. Playwright 실행기는 Chromium 설치 여부를 확인하고 없으면 설치하며 네트워크 접근이 필요하다.

```powershell
Push-Location backend
try { .\mvnw.cmd -q verify; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
finally { Pop-Location }
npm --prefix frontend ci
npm --prefix frontend run build
.\scripts\run-qa-e2e.ps1
node .hybrid/bin/hybrid.mjs validate-plan .planning/phases/02-product-expansion/PLAN.md
node .hybrid/bin/hybrid.mjs schedule .planning/phases/02-product-expansion/PLAN.md
git diff --check
```

E2E 스크립트는 `compose.qa.yaml`에 별도 Compose 프로젝트와 PostgreSQL 볼륨을 만들고 `55432/18081/5174` 포트를 확인한다. DB와 `/api/auth/csrf`, Vite 홈 화면의 준비 상태를 기다린 뒤 백엔드와 Vite를 숨김 프로세스로 실행하고, 종료 시 해당 프로세스와 QA 프로젝트/볼륨만 정리한다. 사용자 개발 DB·Compose 볼륨은 건드리지 않는다. 테스트 계정과 레코드도 테스트별 임시 항목만 만든다. 네이버 키가 없으면 키 누락 안내와 캠퍼스/브라우저 위치 흐름을 검증하고, 장소 선택 결과가 영구 저장되지 않는지 확인한다.
