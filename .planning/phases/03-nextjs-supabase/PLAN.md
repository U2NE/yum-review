# Yum Review — 루트 Next.js·Supabase 전환 계획

**기준 범위:** .planning/phases/03-nextjs-supabase/SPEC.md 및 앞 단계에서 승인된 관리자·업주 카탈로그 관리, 반별점 리뷰, 카테고리/거리 탐색, 죽전 초기 카탈로그, 편집형 브랜드.
**위험 등급:** Hybrid Tier 3 / 높음 — 인증·RLS·Storage 권한, 기존 계정 및 사진 이관, 공개 Production 배포 경로.
**계획 상태:** SPEC 승인 완료. 계획 감사와 승인된 실행 시작점 이후 로컬 disposable 데이터 기반의 Next.js·Supabase 구현을 진행할 수 있다. 호스팅 인증·이메일·스토리지 한도·실제 데이터 수량·운영 cutover는 별도 운영 gate다.
**현황 기준:** 저장소에는 루트 Next.js·Supabase 프로젝트가 없다. 현재 UI는 frontend/의 React 19·Vite이고 API는 backend/의 Spring Boot·PostgreSQL·Flyway다. V1–V6은 기존 Spring 데이터베이스의 이력이며 V3에는 정확히 매칭되는 과거 합성 픽스처를 삭제하는 코드가 있다. Supabase용으로 V1–V6을 실행하지 않는다.
**Vercel:** 사용자가 Production용 Supabase 환경변수를 이미 설정했고 U2NE/yum-review로의 코드 push를 요청했으며, Vercel이 Git `main`에 연결되어 있다고 알려주었다. 검토·QA를 마친 코드 push와 기존 자동 Vercel 빌드는 이미 승인된 경로다. 환경 변수 값이나 비밀은 읽거나 출력하거나 바꾸지 않는다. 저장소 연결, Production Branch, 도메인 또는 배포 설정은 바꾸지 않는다. 코드 push는 어떤 별도 승인 대상 DB 초기화·삭제 또는 운영 데이터 cutover와 분리한다.

<!-- hybrid-plan:v1
{
  "tier": 3,
  "highRisk": true,
  "must_haves": [
    "루트 next build와 Next.js App Router로 기존 로그인·가입·로그아웃, 탐색, 관리자/업주 권한, 리뷰·사진 흐름을 제공한다.",
    "기존 사용자 ID는 private.legacy_user_identity에만 보관하고 공개 profiles에는 두지 않는다. 실제 source/target 행·관계 수량은 비파괴 운영 preflight에서 대조하며, 알 수 없거나 충돌하는 행은 생략하지 않고 원인과 영향 건수를 보고한다.",
    "로컬 구현과 합성 fixture 검증은 호스팅 프로젝트 없이 진행한다. 실제 legacy BCrypt 변형의 Auth 호환성은 이미 있는 별도 non-production 호스팅 프로젝트 또는 승인된 read-only/운영 preflight가 있을 때만 검증하며, 실패하면 계정 삭제/임의 비밀번호/무승인 초기화 없이 멈춘다.",
    "Supabase Auth SSR 세션, 공개 테이블 RLS, 비공개 역할 원장, Storage object 정책으로 권한을 강제한다. secret key는 server-only 이관/관리 작업에만 사용한다.",
    "기존 사진 bytes와 메뉴·리뷰 연결을 체크섬으로 대조해 Supabase Storage로 이관한다. 새 업로드는 브라우저에서 직접 전송하고 Vercel 함수로 이미지 본문을 보내지 않는다.",
    "승인된 반별점/선택 세부점수/필수 비이벤트 동의/좋아요/찜/개인 필터/프로필 수정/브랜드 개선을 구현한다.",
    "독립 보안 감사, 독립 코드 검토·데이터 verifier, 실제 로컬 UI에서 버튼별 E2E QA를 통과하기 전에는 운영 반영하지 않는다.",
    "운영 마이그레이션은 추가형·재시도 가능·행 대조형으로만 수행한다. reset, init, truncate, delete, 기존 이력 수정은 승인 없이 수행하지 않는다. 검토·QA 후 요청된 Git push와 기존 자동 Vercel 빌드는 cutover와 별도 경로다."
  ],
  "principles": [
    "기존 Spring DB와 사진 원본은 검증과 이관 승인까지 그대로 보존한다. Supabase 대상에 기존 Flyway migration을 재생하지 않는다.",
    "Production 데이터와 인증 설정은 사전 읽기 전용 검사 없이는 건드리지 않으며, 테스트·Preview·Development를 실제 Production Supabase에 연결하지 않는다. 로컬 개발은 disposable local Supabase/test fixtures로 수행한다.",
    "사용자 JWT로 일반 읽기/쓰기를 수행하고 앱 화면에서 secret/service 키로 RLS를 우회하지 않는다.",
    "소스 사용자 ID, 역할, 확인 상태, 파일 매핑과 대상 UUID 매핑을 끝까지 보존한다. legacy user ID mapping은 private.legacy_user_identity에만 두고, 공개 profile에는 넣지 않는다.",
    "승인된 사진 출처만 보존한다. NAVER 검색 응답이나 권리 불명 메뉴/방문자 사진을 영속화하지 않는다.",
    "모든 기능·권한 테스트는 disposable local Supabase와 synthetic/masked test data에서 실행하며 운영 데이터로 QA하지 않는다. hosted operational gates는 로컬 구현을 막지 않는다."
  ],
  "decisionDrivers": [
    "실제 legacy BCrypt 변형의 hosted Auth 호환성은 확인되지 않았다. local 구현은 synthetic fixture로 계속할 수 있고, hosted 검증은 별도 hosted operational gate다.",
    "SMTP/email confirmation flow와 hosted Storage plan/object limits가 미확인이다. 로컬 개발/QA는 별도 disposable 환경에서 진행한다.",
    "source/target의 실제 행 수·관계·미디어 현황은 live 확인하지 않았다. source에 email verification 필드가 없으므로 기존 계정은 unconfirmed로 매핑하며, 실제 이메일 확인 여부를 추정해 resolved 처리하지 않는다.",
    "Vercel Production 환경변수는 이미 설정되었다는 사용자 지시가 있으나, 실제 값은 계획/저장소에 기록하지 않는다.",
    "요청된 U2NE/yum-review 코드 push와 기존 Git main 자동 Vercel 빌드는 QA 및 독립 검토 이후 허용되어 있다. 이는 DB reset/delete, 운영 데이터 import/cutover 및 Vercel 연결/설정 변경 권한을 부여하지 않는다."
  ],
  "tasks": [
    {
      "id": "00-safe-preflight-and-staging",
      "goal": "로컬 구현을 위한 코드 기반 사전 조사, disposable local Supabase 구성, synthetic test fixture와 비파괴 runbook을 준비한다. 호스팅 프로젝트나 live DB 접근은 요구하지 않는다.",
      "owner": "Platform/Data migration lead",
      "depends_on": [],
      "files_modified": ["docs/migration/local-supabase-setup.md"]
    },
    {
      "id": "01-supabase-schema-rls-storage",
      "goal": "추가형 데이터 스키마, 권한, 인덱스, Storage 제약을 새 Supabase migration으로 만든다.",
      "owner": "Supabase schema/security engineer",
      "depends_on": ["00-safe-preflight-and-staging"],
      "files_modified": [
        "supabase/config.toml",
        "supabase/migrations/<timestamp>_application_schema.sql",
        "supabase/migrations/<timestamp>_rls_and_role_helpers.sql",
        "supabase/migrations/<timestamp>_initial_storage_policies.sql"
      ]
    },
    {
      "id": "02-root-next-foundation",
      "goal": "루트 빌드·App Router·SSR 클라이언트 기반을 만든다.",
      "owner": "Next.js platform engineer",
      "depends_on": [
        "00-safe-preflight-and-staging"
      ],
      "files_modified": [
        "package.json",
        "package-lock.json",
        "next.config.ts",
        "tsconfig.json",
        "app/layout.tsx",
        "app/globals.css",
        "lib/supabase/browser.ts",
        "lib/supabase/server.ts",
        "proxy.ts or middleware.ts"
      ]
    },
    {
      "id": "03-auth-profile-roles",
      "goal": "Supabase Auth와 안전한 프로필/역할 UI, 계정 설정 페이지 및 요청 권한 흐름을 옮긴다.",
      "owner": "Auth/authorization engineer",
      "depends_on": [
        "01-supabase-schema-rls-storage",
        "02-root-next-foundation",
        "08-editorial-brand-and-responsive-ui"
      ],
      "files_modified": [
        "lib/auth/session.ts",
        "lib/auth/guards.ts",
        "lib/supabase/admin.server.ts",
        "app/login/page.tsx",
        "app/signup/page.tsx",
        "app/account/page.tsx",
        "app/admin/page.tsx",
        "components/auth/*",
        "components/admin/OwnerAssignments.tsx",
        "components/site/SiteHeader.tsx"
      ]
    },
    {
      "id": "04-non-destructive-import",
      "goal": "실행 가능한 Node TypeScript sidecar로 계정·카탈로그·리뷰를 안정적인 매핑으로 이관하고 전후 건수와 체크섬을 검증하며, 미디어 경로는 Task07까지 명시적으로 추적한다.",
      "owner": "Data migration engineer",
      "depends_on": [
        "00-safe-preflight-and-staging",
        "01-supabase-schema-rls-storage",
        "03-auth-profile-roles"
      ],
      "files_modified": [
        "package.json",
        "package-lock.json",
        "scripts/migrate/export-spring-data.ts",
        "scripts/migrate/import-supabase.ts",
        "scripts/migrate/verify-supabase-import.ts"
      ]
    },
    {
      "id": "05-catalog-discovery-management",
      "goal": "기존 메뉴/식당 탐색, 위치 선택, 검색·정렬, 관리자·업주 카탈로그 관리를 App Router로 옮긴다.",
      "owner": "Catalog/product engineer",
      "depends_on": [
        "01-supabase-schema-rls-storage",
        "02-root-next-foundation",
        "03-auth-profile-roles",
        "08-editorial-brand-and-responsive-ui"
      ],
      "files_modified": [
        "app/page.tsx",
        "app/restaurants/[id]/page.tsx",
        "app/restaurants/[id]/manage/page.tsx",
        "app/menus/[id]/page.tsx",
        "app/api/location/search/route.ts",
        "lib/data/catalog.ts",
        "lib/data/location.ts",
        "components/catalog/discovery/*",
        "components/admin/MenuEditor.tsx"
      ]
    },
    {
      "id": "06-reviews-likes-wishlists",
      "goal": "0.5점 리뷰, 평가 선택성, 좋아요, 찜 및 홈·내 리뷰·찜 목록의 결합 필터를 구현한다. 계정 설정 페이지는 Task 03 소유다.",
      "owner": "Reviews/personalization engineer",
      "depends_on": [
        "01-supabase-schema-rls-storage",
        "02-root-next-foundation",
        "03-auth-profile-roles"
      ],
      "files_modified": [
        "app/my-reviews/page.tsx",
        "app/wishlist/page.tsx",
        "components/reviews/ReviewForm.tsx",
        "components/reviews/ReviewCard.tsx",
        "components/reviews/ReviewFeed.tsx",
        "components/catalog/MenuCard.tsx",
        "components/catalog/PersonalFilters.tsx",
        "lib/data/reviews.ts",
        "lib/data/likes.ts",
        "lib/data/wishlists.ts"
      ]
    },
    {
      "id": "07-storage-upload-and-photo-lifecycle",
      "goal": "역할 제한 직접 업로드, 사진 변환, 기존 사진 이관, 연결·삭제·재시도 흐름을 완성하고 append-only 후속 Storage migration을 추가한다.",
      "owner": "Media/storage engineer",
      "depends_on": [
        "01-supabase-schema-rls-storage",
        "02-root-next-foundation",
        "03-auth-profile-roles",
        "04-non-destructive-import",
        "05-catalog-discovery-management",
        "06-reviews-likes-wishlists"
      ],
      "files_modified": [
        "components/media/ImageUpload.tsx",
        "lib/media/validate-image.ts",
        "lib/media/storage.ts",
        "lib/data/media.ts",
        "scripts/migrate/import-media.ts",
        "scripts/migrate/verify-media.ts",
        "supabase/migrations/<later-timestamp>_storage_upload_lifecycle.sql"
      ]
    },
    {
      "id": "08-editorial-brand-and-responsive-ui",
      "goal": "새 한입 벡터 브랜드 자산과 독립형 컴포넌트를 만든다. 화면 route/layout에 대한 통합은 해당 파일 소유 Task가 수행한다.",
      "owner": "Product design/front-end engineer",
      "depends_on": [
        "02-root-next-foundation"
      ],
      "files_modified": [
        "public/brand/hanip-mark.svg",
        "components/site/BrandMark.tsx",
        "components/site/brand.module.css"
      ]
    },
    {
      "id": "09-independent-review-and-full-ui-qa",
      "goal": "독립 보안·코드·데이터 검증과 화면별 버튼 QA를 실행하고 증거를 남긴다.",
      "owner": "Independent security reviewer + independent verifier + QA owner (none may be the feature author)",
      "depends_on": [
        "01-supabase-schema-rls-storage",
        "02-root-next-foundation",
        "03-auth-profile-roles",
        "04-non-destructive-import",
        "05-catalog-discovery-management",
        "06-reviews-likes-wishlists",
        "07-storage-upload-and-photo-lifecycle",
        "08-editorial-brand-and-responsive-ui"
      ],
      "files_modified": [
        "frontend/e2e/mvp.spec.ts",
        "e2e/*",
        "docs/migration/ui-qa-matrix.md",
        ".planning/phases/03-nextjs-supabase/SECURITY-REVIEW.md",
        ".planning/phases/03-nextjs-supabase/INDEPENDENT-VERIFICATION.md"
      ]
    },
    {
      "id": "10-authorized-code-push",
      "goal": "독립 검토 및 QA 완료 후 사용자가 이미 요청한 U2NE/yum-review Git main 코드 push를 수행하고 기존 자동 Vercel 빌드를 확인한다. 별도 push 승인 요청은 하지 않는다.",
      "owner": "Lead",
      "depends_on": ["09-independent-review-and-full-ui-qa"],
      "files_modified": []
    },
    {
      "id": "11-hosted-preflight-and-production-cutover",
      "goal": "요청된 코드 push와 기존 자동 Vercel 빌드가 끝난 뒤, 비파괴 hosted preflight를 수행하고 필요한 운영 gate와 별도 cutover 승인을 모두 통과한 경우에만 운영 데이터 import를 수행한다.",
      "owner": "Lead, with data/platform owners",
      "depends_on": [
        "09-independent-review-and-full-ui-qa",
        "10-authorized-code-push"
      ],
      "files_modified": [
        "docs/migration/supabase-cutover-runbook.md",
        ".planning/phases/03-nextjs-supabase/MIGRATION-REPORT.md"
      ]
    }
  ],
  "testStrategy": {
    "unit": [
      "별점 half-step, 전체 필수/세부 NULL, 산술 평균, 코멘트 1,000자 검증, 필터 조합과 거리 반경 경계.",
      "이미지 MIME/magic bytes/크기 경계와 10MB 초과 최적화, EXIF 회전, 손상 파일, Storage 업로드 재시도."
    ],
    "integration": [
      "로컬 disposable Supabase에 신규 migration만 적용하고 RLS·권한 표를 익명/멤버/업주/서버 관리자 역할별로 검증.",
      "synthetic 또는 승인된 마스킹 source fixture에서 사용자·역할·가게·메뉴·리뷰·이벤트 동의·사진 연결을 가져와 모든 source ID 매핑, 수량, orphan, checksum을 비교.",
      "실제 legacy BCrypt 변형 및 기존 비밀번호 로그인 검증은 호스팅 operational gate다. 이미 존재하는 별도 non-production hosted project 또는 승인된 preflight에서만 수행하고, 새 유료 프로젝트를 만들지 않는다.",
      "스토리지 익명 읽기/인증 업로드/타인 리뷰 첨부/다른 가게 메뉴 사진 쓰기/비연결 객체 읽기를 직접 API로 거부 확인.",
      "Production과 Preview/Development 설정은 값 없이 범위만 검증하며, 실제 운영 데이터에 연결된 테스트는 금지."
    ],
    "e2e": [
      "루트 Next 서버를 실제 localhost에 띄워 disposable local Supabase에 연결해 검증한다. SMTP/email confirmation을 사용하는 hosted 흐름은 별도 운영 gate이며, 실행 중인 로컬 리뷰 링크를 사용자에게 넘긴다.",
      "360/390px 모바일, 768px 태블릿, 1440px 데스크톱에서 guest/member/restaurant-owner/server-admin 흐름을 각각 확인한다.",
      "모든 페이지의 모든 조작 버튼을 matrix에 기록하고 클릭 전 상태, 결과 상태, 오류/성공 안내, 데이터 효과를 확인한다.",
      "검색어 입력·실행·지우기, 음식 종류, 지역 적용, 300m/500m/1km/전체, 장소 검색/선택, 현재 위치 허용/거절, 정렬을 조합하고 새로고침·뒤로·앞으로 이동 후 같은 필터 결과를 확인한다.",
      "회원가입·로그인·안전한 return 경로·로그아웃·세션 만료·표시 이름 변경·비밀번호 변경과 이메일 불변을 확인한다.",
      "전체/세부 별 반쪽 선택·키보드 포커스·재클릭 해제, 세부점수 비움, 전체점수 필수, 2.5 안내, 비이벤트 동의 필수, 1,000자 경계를 확인한다.",
      "타인 리뷰 좋아요 추가/취소와 중복 방지, 본인 리뷰 좋아요 UI 부재 및 직접 요청 거부를 확인한다.",
      "메뉴 찜/해제, 내 리뷰/찜한 메뉴 페이지 각각의 검색·종류·지역·거리·정렬 필터 조합, 비로그인 개인 필터의 로그인 이동과 URL 복원을 확인한다.",
      "관리자 사용자 찾기·업주 배정·해제, 업주 메뉴 등록/수정/내리기, 타 가게 쓰기 및 업주 리뷰 삭제 거부, 관리자 리뷰 삭제 확인.",
      "메뉴 사진/리뷰 사진 선택·최적화·직접 업로드·연결·삭제·실패 재시도·권한 오류를 확인한다. 리뷰/메뉴 사진 권리 체크 항목은 없고 비이벤트 동의만 남는지 확인한다.",
      "상태별 loading/empty/error/retry/성공 알림, 모바일 메뉴 열고 닫기, 링크 이동, breadcrumbs, 이미지 미등록 placeholder, 키보드 접근을 모두 확인한다."
    ],
    "security_review": [
      "독립 보안 검토자는 공개 스키마·Storage 전체 정책, private 역할 원장, security definer 고정 search_path, grants, Auth SSR 쿠키, cache, server actions, 관리자 키 사용 경로, 로그/번들 비밀 노출 여부를 검토한다.",
      "독립 verifier는 각 요구사항 대 구현·SQL·E2E 증거 매핑, 이관 수량/체크섬, 실패 시 운영 데이터 비변경 증거를 따로 승인한다.",
      "기능 작성자와 같은 사람이 보안 승인 또는 독립 코드 리뷰를 겸하지 않는다. 높은 위험 결함은 수정 후 독립 재검토까지 운영 cutover를 금지한다."
    ]
  },
  "spec_acceptance_criteria": [
    "AC1–2: 구현 01·06; 독립 검증 09 — 5개 반쪽 별, 전체 필수, 세부 NULL, 산술 평균 및 미평가 표시.",
    "AC3: 구현 06·07; 독립 검증 09 — 새 리뷰/메뉴 사진 권리 체크·전송 제거, 기존 이벤트 비참여 동의 유지.",
    "AC4: 구현 05·08; 독립 검증 09 — 기록의 기준 closing note 제거, 한국어 카피·고유 SVG 로고·반응형 위계.",
    "AC5: 구현 01·06; 독립 검증 09 — 타인 좋아요 토글/중복 방지, 본인 리뷰·익명 요청 RLS 차단.",
    "AC6: 구현 05·06; 독립 검증 09 — 메뉴 찜/해제와 홈·내 리뷰·찜 목록 각각의 검색/종류/지역/거리/정렬 조합 및 URL 상태 복원.",
    "AC7: 구현 01·03; 독립 검증 09 — 표시 이름/비밀번호만 변경, 이메일 비수정, 타인 계정 정보 보호.",
    "AC8: 구현 02·03·05·06·07·08; 독립 검증 09 — 루트 Next build, 기존 주요 로그인·탐색·관리·리뷰 흐름.",
    "AC9: 구현 01·03·05·06·07; 독립 검증 09 — 모든 공개 테이블·Storage RLS·최소 grant·필요 인덱스, direct request 우회 차단.",
    "AC10: 구현 04·07; 독립 검증 09은 synthetic fixture를 검증하고 운영 preflight 11은 live counts/relations/checksums를 대조 — 기존 데이터 전량 대조·보존 및 누락 원인 보고.",
    "AC11: 구현 02·03; 독립 검증 09은 source/build/log/provenance의 secret 미노출을 확인하고 운영 preflight 11은 값 없이 Production variable scope/presence를 확인 — Vercel 연결 불변."
  ]
}
-->

## 실행 불변조건

- 새 Supabase migration만 작성한다. backend/src/main/resources/db/migration/V1–V6을 Supabase 프로젝트에 적용하지 않는다. 특히 V3의 픽스처 DELETE 경로를 운영 이관·배포에서 실행하지 않는다.
- Supabase/Vercel Production에서 db reset, DROP, TRUNCATE, DELETE, 기존 이력 수정, 빈 DB 초기화, 사진/계정 정리를 실행하지 않는다. 제품 데이터를 넣을 때도 대상 스키마와 자연키 충돌을 먼저 조사하고 기존 값과 다르면 즉시 중단한다.
- Production DB/Auth/Storage를 준비되기 전에 읽거나 쓰지 않는다. 실행 시 읽기 전용 인벤토리와 암호화된 백업이 먼저다. 백업 덤프, 원본 hash, 이메일, 비밀번호, 토큰은 저장소 및 계획 보고서에 넣지 않는다.
- 비밀번호 hash는 비밀 취급한다. 이관 도구는 server-only 실행, 표준출력/로그 미기록, 임시 사본 제거 및 접근권한 제한을 갖춘다. 기존 hash는 일반 public 테이블에 저장하지 않는다.
- 일반 앱 요청은 사용자 세션/JWT로 RLS를 사용한다. Supabase secret key는 server-only migration 도구에만 제한하며 일반 페이지·Server Action·API route의 DB 접근에 사용하지 않는다.
- getSession() 쿠키값만으로 서버 권한 판단을 하지 않는다. Supabase SSR 권장 방식으로 getClaims()로 요청 주체를 확인하고, 필요할 때만 getUser()로 Auth 서버 확인을 한다. Next 버전에 맞는 proxy.ts 또는 middleware.ts를 고른다. 인증 응답은 동적 처리하고 사용자별 세션 쿠키가 다른 사용자에게 캐시되지 않게 한다.
- 이메일 확인, SMTP, redirect allow-list 및 hosted Storage 크기 제한은 실제 hosted 흐름을 확인하기 전까지 운영 Gate로 둔다. 이 불확실성은 disposable local Supabase에서 하는 앱·스키마·UI 구현과 QA를 막지 않는다. Auth 확인 설정은 임의로 끄거나 바꾸지 않는다.
- 사용자의 NAVER 장소 검색 결과는 저장하지 않는다. 선택한 좌표/label은 브라우저 history state 수준에서만 유지해 재방문·뒤로/앞으로 동작을 보장하며 주소창·서버 로그·DB에 정밀 현재 위치를 남기지 않는다.
- 실제 BCrypt 변형 불일치, live row/관계/파일 checksum 불일치, RLS 실패, SMTP/email 흐름 또는 hosted Storage 제한 불만족 중 하나라도 있으면 운영 단계로 진행하지 않는다. 로컬·synthetic 구현과 검증은 계속할 수 있다.

## 단계별 상세

### 00 — 로컬 구현 사전 점검과 disposable test setup

Owner: Platform/Data migration lead.

1. 코드와 Flyway 이력만으로 source data model·고유 키를 확정한다. 이 단계에서 live source DB, hosted Supabase, credentials 또는 `.env`를 읽지 않는다.
2. disposable local Supabase 구성과 synthetic test fixture를 준비한다. 새 유료 hosted project를 만들지 않는다. 사용 가능한 로컬 환경에서 Auth, RLS, migrations, UI flow를 개발·검증하고 hosted 설정이 필요한 작업만 별도 Gate로 남긴다.
3. 실제 source·target 수량과 관계, 충돌, media bytes/checksum은 later hosted operational preflight에서 read-only로 확인한다. 백업은 그 preflight가 진행될 때 repository 밖에서 만들며, PII/hash/credential을 계획 문서나 log에 남기지 않는다.
4. 실제 Spring BCrypt prefix/strength/variant와 기존 비밀번호 로그인 검증은 이미 존재하는 별도 non-production hosted project 또는 승인된 production preflight에서만 수행한다. 둘 다 없으면 이 operational gate는 미해결로 두되 local 구현은 막지 않는다. 검증 실패 시 hash를 바꾸거나 계정을 버리거나 임시 비밀번호를 발급하지 않는다.
5. SMTP/email confirmation, site/redirect allow-list와 hosted Storage plan/bucket/최대 byte 한도는 실제 hosted 흐름에서 확인한다. Auth 확인 설정은 변경하지 않고 새 유료 project를 만들지 않는다. SMTP나 hosted Storage가 미충족이면 해당 운영 flow/cutover를 막지만 local implementation은 계속한다.
6. 사용자가 이미 설정했다고 한 Vercel Production variable은 operational preflight에서 이름·scope·presence만 가림 처리 확인한다. 값은 읽거나 출력하지 않는다. 저장소 연결, Production Branch, 도메인, 환경 설정은 바꾸지 않는다.
7. Task 11만 `supabase-cutover-runbook.md`와 `MIGRATION-REPORT.md`를 소유하며, 비파괴 source/target inventory 결과와 각 미해결 운영 Gate를 기록한다. 데이터가 이미 있는 Supabase table은 빈 테이블로 가정하지 않는다.

### 01 — Supabase 스키마, RLS 및 Storage 권한

Owner: Supabase schema/security engineer. 00 완료 필요.

1. Supabase SQL 파일을 새로 추가한다. target schema에 충돌이 있으면 CREATE IF NOT EXISTS로 덮지 말고 기존 definition과 row를 조사해 append-only 변경으로 조정한다.
2. profiles는 Auth UUID에 연결하고 표시 이름만 공개 앱 profile data로 제공한다. 비공개 이메일/password hash 또는 legacy user ID를 profiles에 두지 않는다.
3. legacy user ID ↔ Auth UUID 매핑은 `private.legacy_user_identity`에만 둔다. restaurant/menu/review 원본 numeric IDs는 필요한 legacy mapping과 함께 보존하고, system role과 restaurant_owner도 private schema/table에 보관한다. client-editable user metadata를 권한에 사용하지 않는다.
4. Review score는 NUMERIC(2,1), overall 필수, taste/value/portion NULL 가능으로 정의한다. half-step/range 제약을 추가하고 consent는 nullable로 이관해 과거 동의 공백을 참으로 만들지 않는다. 기존 comment 1,000자 및 user/menu uniqueness를 유지한다.
5. review_likes는 (user_id, review_id) unique; menu_wishlists는 (user_id, menu_id) unique로 만들고 권한에 필요한 복합 인덱스를 추가한다. 공개 좋아요 수는 집계만 노출하고 raw user ID 목록은 공개하지 않는다.
6. public 노출 테이블 모두 RLS를 켠다. profile/찜은 소유자만 읽고 수정한다. 리뷰 소유자만 생성/수정/삭제하며, 신뢰된 server admin 정책과 필요 시 메뉴 소유 정책만 추가한다. 리뷰 본인 좋아요 거부를 DB 정책 또는 제한된 DB 함수에서도 강제한다.
7. 역할 판정 함수가 필요하면 private schema, SECURITY DEFINER, 고정 search_path, 최소 execute grants를 사용하고 SQL injection/호출자 바꿔치기 방어를 검토한다. UPDATE에는 SELECT policy, USING, WITH CHECK를 모두 테스트한다.
8. 메뉴·리뷰 사진은 private Storage bucket과 경로 정책을 기본으로 한다. 익명 열람은 공개 메뉴/리뷰에 실제 연결된 활성 object에만 허용하고 signed URL은 RLS를 통과한 object로만 발급한다. 미연결 임시 object나 비공개 bucket 경로는 접근 거부한다. 업로드는 owner/member path 및 object row와 DB 소유관계로 제한한다.
9. 업로드 덮어쓰기를 금지하고 랜덤 object path를 쓴다. 삭제·교체는 DB 연결/가시성을 먼저 차단하고 Storage 삭제를 재시도 가능한 후속 작업으로 처리한다. Storage 권한이 DB transaction과 원자적이지 않음을 기록하고 고아 object 확인기를 둔다.

### 02 — 루트 Next.js 런타임 및 SSR 인증 기반

Owner: Next.js platform engineer. 00 완료 필요; 01과 별도 파일로 진행 가능.

1. root package manifest와 lockfile에 Next.js App Router 및 @supabase/ssr/supabase-js를 추가한다. Next.js 버전을 고정하고 Vercel root에서 next build가 실행되게 한다. 기존 frontend/ 및 backend/ 코드는 import 단위로 이동하며 데이터 검증 전까지 삭제하거나 덮지 않는다.
2. 브라우저용 publishable client와 cookie 기반 server client를 lib/supabase/browser.ts, server.ts로 분리한다. secret key는 client import가 가능한 module에서 참조하지 않는다. lib/supabase/admin.server.ts는 Auth import 도구에만 제공하고 client bundle에서 명시적으로 제외한다.
3. Next 버전에 맞게 proxy.ts 또는 middleware.ts를 한 가지 선택해 세션을 갱신한다. Server Component에서는 쿠키를 쓰려 하지 말고 refresh-cookie 응답을 전달한다. getClaims()로 서버 요청을 검증하고 getSession()만으로 권한을 인정하지 않는다.
4. 로그인 상태에 의존하는 페이지/API를 dynamic/no-store로 처리한다. 공개 카탈로그의 안전한 cache와 사용자별 리뷰/좋아요/찜/계정 응답을 분리한다.
5. 로그인/회원가입/로그아웃 및 보호 경로에서 원래 목적지 return을 유지하되 //, /\, 외부 URL open redirect를 막는다. 오류는 짧은 한국어 메시지로 바꾸며 credential, token, stack trace를 노출하지 않는다.
6. root app과 기존 frontend/는 검증 단계까지 동시에 남긴다. 임시 demo API나 production DB fallback은 만들지 않는다.

### 03 — 사용자 계정, profile 및 역할 UI

Owner: Auth/authorization engineer. 01–02 완료.

1. signup/login/logout과 세션 갱신을 Supabase Auth로 교체한다. local synthetic user로 화면·권한 흐름을 구현한다. 이메일 confirmation/SMTP 실동작은 hosted operational gate로 확인하며, 이메일 확인을 끄거나 모든 계정을 verified로 강제하지 않는다.
2. Task 03만 `app/account/page.tsx`와 계정 설정 UI를 소유한다. 표시 이름은 profile 소유자만 변경 가능하게 하고 이메일 입력 필드는 추가하지 않는다. 새 비밀번호는 Auth API에서 자기 계정으로만 갱신하고 검증 오류는 한국어로 표시한다. 누구든 타 계정 이메일·비밀번호 hash를 조회할 수 없어야 한다.
3. 기존 role/owner mapping은 private trusted table로 옮긴다. SERVER_ADMIN만 사용자 찾기·업주 할당/해제를 할 수 있게 하고, 할당된 업주는 자기 식당의 메뉴만 관리한다. UI 숨김은 권한 검증이 아니다.
4. 현재 UI의 /admin 사용자 검색·식당 선택·업주 연결·해제, 관리자 메뉴/리뷰 액션, owner restaurant 메뉴 관리 접근을 유지한다. 초기 admin bootstrap/reset을 새로 만들지 않는다.
5. 가져온 legacy profile에 표시 이름이 없다면 이메일에서 이름을 만들어 공개하지 않는다. 일반 중립 표시 이름으로 시작해 본인이 바꾸게 하며 source 리뷰 작성자 표시 의미가 달라지면 migration report에 영향 범위를 남긴다.

### 04 — Non-destructive 계정·카탈로그·리뷰 이관

Owner: Data migration engineer. 00–03 완료. Import/export/verification 코드는 synthetic fixture로 구현한다. 실제 계정 import 실행은 Task 11 preflight와 actual legacy BCrypt gate를 통과한 뒤만 가능하다.

1. source의 모든 app_user/role/owner/restaurant/menu/review 행을 추출하고, 원본 row/relationship counts와 stable IDs를 manifest로 만든다. 이관 임시 파일은 repo 밖의 접근 제한 경로에 두고 완료 후 안전하게 제거한다.
2. Auth 사용자를 Auth Admin API로 생성해 검증된 BCrypt hash 및 확인 상태를 매핑하고 새 Auth UUID ↔ legacy user ID mapping을 `private.legacy_user_identity`에 저장한다. raw hash를 public table/profile이나 로그에 넣지 않는다.
3. source에 email-verification field가 없으므로 모든 legacy account의 Auth 확인 상태를 unconfirmed로 매핑한다. 이 status mapping은 정책상 확정하지만 실제 이메일 확인 여부, SMTP 동작, 사용자 확인 flow가 operational gate를 통과했다고 추정하거나 “resolved”로 표시하지 않는다.
4. restaurants → menus → reviews 순으로 legacy IDs를 유지/매핑해 가져온다. system_role, restaurant_owner, price, category, active, 좌표/region, full/half scores, 기존 review comment, 기존 consent null/값을 보존한다. 빈 consent를 true로 채우지 않는다.
5. 기존 Supabase에 같은 legacy ID/natural key가 있을 경우 내용을 비교한다. 정확한 동일 행만 재실행에 대해 안전하게 skip 가능하고, 다른 행이면 덮어쓰기/삭제 없이 중단한다. silent skip은 금지한다.
6. 현재 카탈로그 전체를 가져온다. 기존 V4–V6 seed만 단독 실행해 덮어쓰거나 중복 삽입하지 않는다. NAVER Local API 결과·비허가 사진은 import하지 않는다. 자료 출처는 docs/jukjeon-catalog-sources.md를 유지한다.
7. synthetic fixture 결과는 source/target entity counts, relation/orphan counts, legacy↔Auth UUID map totals, 충돌과 영향 수로 검증한다. live source/target counts는 Task 11 read-only preflight 전까지 미확인으로 표시하며, 불일치가 있으면 운영 import를 멈춘다.

### 05 — 메뉴/식당 탐색, 장소 검색, 관리자·업주 카탈로그

Owner: Catalog/product engineer. 01–04 완료.

1. 기존 화면/요청 책임을 App Router로 옮긴다: 홈페이지, restaurant detail, menu detail, 관리자/업주 menu editor. 데이터 함수는 lib/data/catalog.ts; SQL/RPC 입력은 zod 등 server-side validator로 검증한다.
2. 검색어, 음식 종류, 지역, 반경, 정렬(overall/taste/value/portion/reviewCount)을 한 쿼리에서 조합하고 stable tiebreaker와 NULL-last 정렬을 정의한다. 좌표 누락 가게/거리 제외 안내도 유지한다.
3. 캠퍼스 좌표를 초기 중심으로 하고 사용자 장소 검색과 현재 위치 버튼을 제공한다. Geolocation 거절·미지원·timeout에 한국어 상태가 있어야 하며 장소 검색 선택과 반경 버튼 모두 목록을 갱신한다.
4. NAVER Local 검색을 유지해야 하면 app/api/location/search/route.ts에서 server-only credential로 요청하고, 응답은 검색 선택 도움만으로 처리한다. API 응답을 DB나 영속 파일에 쓰지 않는다. 설정되지 않은 credential은 오류가 아닌 안내 상태로 표현한다.
5. 쿼리 가능한 탐색값은 URL에서 보존하고, 정밀 위치 중심은 browser history state에만 보관한다. 필터 변경, 새로고침, 메뉴 상세 후 뒤로/앞으로에서 상태와 표시 결과를 복원한다.
6. 기존 공개 화면에서 메뉴 카드·식당 정보·전체/세부 평균·review count·이미지를 보존한다. 지역/검색/정렬이 모바일에서도 조작 가능하다. Task 05가 `app/page.tsx`를 소유하고 closing-note/기록의 기준 섹션을 제거하며 히어로 카피를 갱신한다.
7. docs/jukjeon-catalog-sources.md 출처/주의 문구를 유지한다. 확인 안 된 뚱띵이 메뉴/가격/사진/좌표를 채우지 않고, V4/V5/V6 자료의 기존값과 충돌하면 자동 upsert하지 않는다.
8. 개인화 필터 UI/쿼리 로직은 Task 06이 구현하고, `app/page.tsx`의 route/filter composition은 Task 05만 편집한다.

### 06 — 별점·리뷰·좋아요·찜·개인화

Owner: Reviews/personalization engineer. 01–04 완료.

1. components/reviews/ReviewForm.tsx에서 별점 컨트롤을 별 모양 5개만 렌더링하고 각 별 왼쪽/오른쪽 hit area로 0.5 단위를 고르게 한다. Radio/button 접근성, arrow/Tab 키보드, 포커스 표시, 명확한 aria-label과 screen-reader 값 낭독을 구현한다.
2. 전체 별점은 필수, 전체 범위 0.5–5.0. 맛/가성비/양은 선택, 같은 값 재클릭 시 해당 보조점수만 null 처리한다. 코멘트는 1,000자 제한. 2.5=보통 안내를 보이고 menu/review/card에서 전체 평균을 보조 점수보다 강조한다. 선택하지 않은 세부 점수는 미평가로 표시한다.
3. 신규 리뷰 작성·수정 시 이벤트 비참여 consent만 계속 필수로 받는다. 기존 null consent는 null로 보존한다. 사진 권리 확인 UI와 transport/validation field를 양 경로에서 제거하고 DB 새 upload 경로도 그런 입력을 요구하지 않는다.
4. 타인 공개 리뷰 좋아요 토글과 총수/내 상태, 본인 리뷰 좋아요 숨김, 유니크 제약과 DB 정책을 연결한다. 앱/API에서 중복 호출해도 한 건이며 자기 좋아요 insert는 RLS와 DB 레벨에서 차단된다.
5. 메뉴 찜 저장/해제와 로그인 사용자 전용 목록을 구현한다. 홈뿐 아니라 `/my-reviews`와 `/wishlist` 목록 자체에도 검색·음식 종류·지역·반경·정렬 컨트롤을 두고 URL 상태로 유지한다. 내 리뷰 목록은 내 리뷰 데이터만, 찜 목록은 찜한 메뉴만 보여 주며 기존 위치 중심·현재 위치·장소 검색/선택 흐름을 유지한다.
6. 리뷰 작성/수정/삭제, 사진 첨부 변경, 평균과 count 재조회, 관리자 삭제 confirmation을 유지한다. 기존 1 user/menu unique 정책을 바꾸지 않는다.
7. account settings route/page는 Task 03 소유이며, 이 Task에서는 만들거나 수정하지 않는다.

### 07 — Storage 직접 업로드와 기존 미디어 이관

Owner: Media/storage engineer. 01–06 완료.

1. Browser에서 authenticated local/test Supabase Storage로 직접 업로드한다. 이미지 bytes를 Next route/server action/Vercel function으로 전달하지 않는다. 100MB 이상은 브라우저와 Storage 제한에서 거부하고 10MB 초과는 우선 client 최적화를 시도한다. 실제 hosted plan/object byte limit 충족은 별도 운영 Gate다.
2. 6MB보다 큰 파일은 Supabase 권장 resumable TUS 흐름을 사용한다. file type 허용목록 외에 실제 image signature/디코딩 검사를 하고 과도한 해상도·손상 이미지를 안전하게 거부한다.
3. 사진권리 checkbox 값이나 자동 생성 rightsBasis를 저장하지 않는다. 과거 media_asset에 실제로 있던 rights/provenance 정보는 legacy 이력으로 보존하되 새 기록에 사용자 동의를 했다고 꾸미지 않는다.
4. Source media_asset과 review_photo, menu.photo_media_id, V6 photo_url 경로를 source manifest로 열거하는 importer/verifier를 만든다. synthetic/masked fixture의 파일 수, byte 수, SHA-256과 DB 연결을 검증하고, 실제 live source inventory는 Task 11에서 확인한다.
5. 기존 파일은 새 private bucket에 새 고유 경로로 업로드한 뒤 byte/checksum 및 연결을 확인한다. Auth service import는 storage owner_id 자동 채움을 가정하지 않고 explicit legacy uploader/mapping을 보존한다. 재업로드 실패 때 source 파일/URL을 계속 사용할 수 있게 둔다.
5a. 사용자가 제공한 `곰포차 메뉴.zip`은 파일명의 메뉴명·가격과 이미지 원본을 사용해 곰포차 죽전점 및 메뉴를 추가형으로 등록한다. 분류는 PUB, 지역은 죽전, 주소·좌표와 확인되지 않은 설명은 비워 둔다. 로컬 disposable Supabase에서만 명시적으로 실행하며 같은 내용은 재실행 시 건너뛰고 충돌 행은 덮어쓰지 않고 중단한다. 사진은 private bucket에 checksum 확인 후 저장하고 해당 메뉴 사진으로 연결한다. ZIP 원본은 보존한다.
6. 새 리뷰 사진은 리뷰 작성/첨부 ID 및 uploader UUID와 연관시킨 후에만 공개용 signed read를 허용한다. 메뉴 사진 업로드는 그 restaurant owner 또는 SERVER_ADMIN만 가능하게 한다. 다른 사용자/가게 ID를 바꾼 path 조작을 Storage RLS에서 거부한다.
7. 연결 제거/리뷰 삭제로 사진 참조가 끊겨도 즉시 비가역 삭제하지 않는다. 먼저 public/signed visibility를 revoke하고 tombstone/재시도 가능한 GC를 운영하며 확인 기간 후 별도 cleanup 승인 없이는 원본을 없앤다.
8. 사용자 UI의 사진 교체·제거·업로드 실패 안내·재시도와 파일 목록을 확인한다. Vercel 4.5MB payload 제한을 우회하는 direct upload를 검증한다.

### 08 — 브랜드 자산 및 컴포넌트

Owner: Product design/front-end engineer. 02 완료. Route/layout 통합은 Task 03/05 소유다.

1. 새 public/brand/hanip-mark.svg와 React BrandMark component를 음식/메뉴/별점과 연결된 고유한 벡터 워드마크로 만든다. 사진·리뷰·평점을 덮지 않는다.
2. 컴포넌트 전용 brand.module.css에 브랜드 크기·간격·반응형 규칙을 둔다. 기존 route/layout/global stylesheet 파일을 수정하지 않는다.
3. Task 03/05가 각자 소유한 SiteHeader/Home route에서 새 컴포넌트를 통합한다. 홈 카피와 closing-note 동작은 Task 05가 소유하며, 리뷰 폼 안의 비이벤트 동의는 유지한다.

### 09 — 독립 검토, verifier 및 버튼별 UI QA

Owner: 구현 작성자와 다른 독립 보안 검토자, 다른 독립 코드 verifier, QA owner. 01–08 완료. SPEC AC1–AC11은 상단 `spec_acceptance_criteria`에 구현 Task와 이 Task의 독립 검증 owner가 각각 매핑되어 있다. AC10/11의 live/hosted 확인은 Task 11 gate도 따른다.

1. Security reviewer는 SQL/RLS/grants/private role helper/Storage policy/SSR proxy/cookie refresh/cache/return URL/upload path/secret key import 및 로그·브라우저 bundle leak를 독립 검토한다. SECURITY-REVIEW.md에는 finding, 위험도, 재검증 결과만 쓰고 비밀값이나 행 데이터를 쓰지 않는다.
2. Independent verifier는 AC1–AC11 각각을 코드·migration·local test evidence에 연결하고 루트 build, migration 재실행, id 충돌 fail-closed, synthetic fixture counts/관계 수, photo hashes, 권한 거부 응답, secret scan 결과를 기록한다. live source/target counts와 hosted gates는 독립 증거로 확인될 때까지 unresolved로 둔다. 기능 구현자는 자기 작업을 단독 승인하지 않는다.
3. 모든 화면에서 보이는 모든 버튼/링크/선택 컨트롤을 docs/migration/ui-qa-matrix.md의 개별 행으로 등록한다. 대상 사용자(role), viewport, 시작 상태, 동작, 기대 화면 변화/API 상태/데이터 결과, 실패 안내, 검증 결과를 남긴다.
4. Matrix에는 guest/member/owner/server admin별 header/mobile menu, search/clear, category, region apply/clear, place search/result select/current location, radius, sort, menu/restaurant links, signup/login/logout, return path, profile name/password, review stars/comment/consent/photo, like, wishlist, personal filters, review edit/delete/cancel, admin owner assign/revoke, owner menu create/edit/unlist, error retry를 빠짐없이 포함한다.
5. 반별점 왼쪽/오른쪽 값 선택과 같은 세부 값 재클릭 해제, 키보드/포커스/aria-label, 로그인 redirect, 필터 조합과 browser back/forward는 별도 캡처 및 결과 기록을 남긴다.
6. 360/390 mobile, 768 tablet, 1440 desktop에서 loading/empty/error/success/image/no-image 상태를 확인하고 스크린샷을 저장한다. 실제 local Next 앱과 isolated Supabase를 실행한 상태에서 사람이 조작해 본 localhost 링크를 사용자에게 넘긴다.
7. 모든 직접 API 요청의 권한도 확인한다. 익명 write, 다른 계정 프로필/찜 조회, 본인 review like, 다른 restaurant menu write, 다른 user media association, detached Storage object access는 전부 거부되어야 한다.
8. blocker는 고친 후 security/code/UI 재검토를 반복한다. 세 번의 같은 유형 재작업 후에도 실패하면 운영 진입을 막고 원 증거와 미해결 영향만 보고한다.

### 10 — 요청된 코드 push

Owner: Lead. Task 09 독립 보안·코드 검토 및 local UI QA 완료 후 수행한다.

1. 사용자가 이미 요청한 U2NE/yum-review Git `main` 코드 push를 수행한다. 별도 generic push 승인을 다시 요청하지 않는다.
2. 기존 Git 연결에 따른 Vercel 자동 빌드 동작을 확인한다. 저장소 연결, branch, 도메인 또는 배포 설정은 변경하지 않는다. 이 push/build는 DB reset/delete나 운영 data import 승인이 아니다.

### 11 — 비파괴 hosted preflight와 별도 cutover 승인

Owner: Lead + Data migration/platform owners. QA/review 통과 후에만 고려.

1. 먼저 비파괴 read-only source/target inventory와 backup, live counts/relationships/checksums, 충돌·역할·미디어 매핑을 확인한다. 실제 DB 접근은 이 hosted preflight에서만 수행한다.
2. 실제 BCrypt variant/password login 검증은 이미 있는 별도 non-production hosted Supabase project 또는 승인된 production preflight에서만 한다. 새 유료 hosted project를 만들지 않는다. 이 gate가 미통과면 실제 계정 import만 보류하고 local 구현은 계속할 수 있다.
3. SMTP/email confirmation/recovery/redirect 흐름과 hosted Storage plan/bucket byte limit을 값 노출 없이 확인한다. 설정을 임의 변경하지 않는다. 실패한 hosted flow와 storage import는 보류한다.
4. migration/import를 하려면 Task 09 QA·독립 검토, Task 10 코드 push/기존 자동 빌드, 위의 비파괴 preflight 및 모든 해당 운영 Gate가 먼저 통과되어야 한다. 이후 별도의 구체적인 cutover checklist 승인 전까지 production schema/data import는 실행하지 않는다.
5. 허용된 경우에만 append-only SQL migration, Auth 사용자, private mapping/profile/roles, catalog/review, Storage object/association 순으로 적용한다. reset, init, DROP, TRUNCATE, DELETE, 기존 migration 수정, 임의 계정/사진 정리는 범위에 없고 실행하지 않는다. 충돌·인증 실패·누락 파일·count/checksum 불일치 시 중단하고 원본과 기존 데이터를 보존한다.
6. AC11의 Vercel Production 변수 scope/presence는 값 없이 확인하고, Preview/Development가 Production Supabase에 연결되지 않았는지도 값 없이 확인한다. 저장소 연결/Production Branch/도메인/설정을 변경하지 않는다.
7. 실패 시 데이터 삭제로 rollback하지 않는다. 이전 앱/source DB 및 Supabase rows/objects를 보존하고, 보고서/runbook에는 비밀·개인정보 대신 상태·영향 건수만 남긴다.

## 현재 미해결 운영 Gate

| Gate | 현재 근거/불확실성 | 통과 조건 |
| --- | --- | --- |
| 실제 legacy BCrypt 변형 | Spring encoder의 prefix/strength/variant 및 hosted Auth 로그인 호환성 미확인 | 실제 대표 hash를 이미 있는 별도 non-production hosted project 또는 승인된 production preflight에서 비밀 취급해 검증. 새 유료 hosted project는 만들지 않음 |
| SMTP·email confirmation | SMTP, confirmation, site/redirect 동작 미확인. source에는 email verification field가 없어 legacy 계정은 unconfirmed로 매핑 | hosted signup/confirmation/recovery 흐름을 검증하고 설정은 임의 변경하지 않음. 미통과 시 해당 hosted email/auth flow를 보류 |
| Hosted Storage plan·limits | 대상 hosted 요금제, bucket 설정, 최대 byte 한도 미확인 | 실제 plan/limit과 RLS/signed access를 확인. 미통과 시 hosted upload/import를 보류; local Storage 구현/QA는 계속 가능 |
| Live source/target counts | 실제 DB row/relation/media 현황 미확인 | 별도 hosted preflight에서 read-only counts, ID 충돌, 역할/email-status 매핑, media bytes/checksum과 backup 확인 |
| Vercel Production variables (AC11) | 사용자가 이미 설정했다고 지시; 값은 확인하지 않음 | preflight에서 이름·scope·presence만 가림 확인하고 Preview/Development 격리를 확인; secret value를 읽거나 기록하지 않음 |
| Production import/cutover | 운영 데이터 변경은 아직 승인되지 않음 | Task 09 QA·독립 검토, 비파괴 preflight와 해당 Gate 완료 후 구체적 checklist에 대한 별도 승인. reset/delete는 승인 범위 밖이며 수행 금지 |

## 완료 정의

구현 완료는 (1) Next.js·schema·UI가 disposable local Supabase/test fixtures에서 승인된 scope를 충족하고, (2) AC1–AC11의 독립 검증과 실제 localhost 버튼별 QA가 통과하며, (3) 요청된 code push 및 기존 자동 Vercel 빌드가 확인될 때 성립한다. 실제 legacy hash, SMTP/email, hosted Storage limits와 live counts는 해당 증거가 확보될 때까지 명시적 unresolved 운영 Gate다. Production import/cutover는 구현 완료 및 code push와 분리된 별도 승인 Gate다.

