# 독립 구현 검증 — Next.js·Supabase 전환

- 검증 역할: 기능 구현에 참여하지 않은 독립 verifier
- Hybrid 실행: `yum-review-next-implementation-foundation-20260925` / `09-independent-verification-static-20260926` / `logical-verifier-final-20260926`
- 계획 결정: `decision-befaf0a00269fff7fde07d82123d684fbc60b8bdd9e091aa13381ce564669319`
- 계획 스냅샷: `570c1d6205bdd2c3d06a7a6ef667f9b2b0a7e637a7245852bf8a6aacd2284712`
- 방법: 승인된 SPEC/PLAN, 현재 소스·SQL·이관 스크립트와 Hybrid 구현자 보고를 읽기 전용으로 대조했다. 이 보고서 자체가 DB 정책 또는 UI 실제 동작의 실행 증거는 아니다.

## 현재 검증 수준

| 관찰 | 결과와 한계 |
| --- | --- |
| TypeScript | 리드가 실행한 `npx tsc --noEmit` 통과. 본 verifier는 재실행하지 않았다. |
| 루트 빌드 | 리드의 `npm run build`는 컴파일과 TypeScript 단계를 통과했지만 페이지 데이터 수집 중 프로세스 힙 부족으로 종료됐고, Turbopack 캐시에서 디스크 공간 부족도 보고됐다. 완성 빌드 통과가 아니다. |
| 사용자 ZIP | 리드의 읽기 전용 미리보기 결과 40장, 원본 이미지 합계 11,576,811바이트. 로컬 DB 등록 또는 Storage 업로드 증거는 없다. |
| 로컬 Supabase | C: 여유 공간이 0바이트가 된 뒤 Docker Desktop이 시작하지 못해 `supabase start` 실패. 신규 SQL migration 적용과 재실행 검증은 못 했다. |
| 실제 화면 및 권한 | localhost 버튼별 QA, 역할별 직접 API 거부 검사, 이미지 업로드, 사진 연결·집계 갱신은 미실행. |
| 운영 환경 | hosted Supabase/Vercel 값·범위·데이터에 접근하지 않았다. 실제 데이터 이관, 운영 인증·메일·Storage 확인은 미실행. |

Hybrid 구현자 보고에는 Task03 인증, Task04 이관과 연결 순서 수리, Task05 탐색/메뉴와 사진 화면, Task06 리뷰/개인화와 사진 화면, Task07 업로드/사진 이관을 구현했다고 기록되어 있다. 보고 자체는 독립 실행 검증을 대신하지 않는다. 특히 Task07 구현자도 migration, DB, 빌드, 브라우저 QA를 실행하지 않았다고 명시했다.

## 수용 기준 AC1–AC11

| 기준 | 정적 근거 | 판정 |
| --- | --- | --- |
| **AC1** 다섯 별의 반쪽 입력, 재클릭 해제, 0.5 평균 | `components/reviews/ReviewForm.tsx:75–125`는 다섯 SVG와 반쪽 hit area를 둔다. `supabase/migrations/20260925130000_application_schema.sql:108–115`는 0.5 간격을 제약하고, `20260925130001_rls_and_role_helpers.sql:789–792`는 산술 평균을 계산한다. **`ReviewForm.tsx:125`는 `optional`일 때에만 같은 별점 재클릭을 null로 바꾸므로 전체 별점 재클릭 해제가 빠져 있다.** | **미통과 — 수정 중.** 수정 후 소스 재확인과 실제 클릭 QA 필요. |
| **AC2** 전체 필수·세부 선택·미평가 | `ReviewForm.tsx:172–180`은 전체 필수만 검사하고 `:154–158`은 세부 null을 허용한다. SQL `application_schema.sql:99–115`의 전체 NOT NULL/세부 nullable과 집계 `rls_and_role_helpers.sql:789–792`의 `avg`가 대응한다. `components/reviews/ReviewCard.tsx:138–164`는 미평가 표기를 둔다. | **정적 구현 확인; DB/UI 실행 미검증.** |
| **AC3** 사진 권리 동의 제거, 비이벤트 동의 유지 | `ReviewForm.tsx:176–180,239–246`, `lib/data/reviews.ts:99–117`, `rls_and_role_helpers.sql:603–622`에 새 리뷰 비이벤트 동의가 있다. `components/media/ImageUpload.tsx:149–210`에는 사진 권리 체크가 없다. 기존 이력 보존용 private rights 테이블은 `application_schema.sql:70–76`이다. | **정적 구현 확인; 실제 작성·업로드 미검증.** |
| **AC4** 홈 문구/로고/반응형 | `app/page.tsx:40–44`의 새 설명형 배너, `components/site/BrandMark.tsx:10–24`와 `public/brand/hanip-mark.svg`가 있다. 현 홈 소스에는 `closing-note`/`기록의 기준` 문구가 없다. | **정적 구현 확인; 모바일·데스크톱 시각 QA 미검증.** |
| **AC5** 타인 리뷰 좋아요 | `components/reviews/ReviewCard.tsx:103–133,185–194`, `lib/data/likes.ts:65–92`에 토글과 본인 버튼 숨김이 있다. `application_schema.sql:196–202`는 사용자·리뷰 복합 기본키, `rls_and_role_helpers.sql:662–677`은 본인 행·타인 공개 리뷰 조건을 둔다. | **정적 구현 확인; 중복·본인·익명 직접 API 거부 미검증.** |
| **AC6** 찜/개인 필터와 검색·종류·지역·거리·정렬 조합 | `lib/data/wishlists.ts:7–57`, `components/catalog/PersonalFilters.tsx:24–45`, `components/catalog/discovery/DiscoveryFilters.tsx:89–100`, `lib/data/catalog.ts:389–412`가 홈 조합을 구성한다. `app/wishlist/page.tsx:29–39`는 계정 목록을 읽는다. 다만 **`app/my-reviews/page.tsx`와 `app/wishlist/page.tsx`에는 각각의 목록을 거르는 UI·쿼리가 없어 원래 사용자 요청의 개인 페이지 필터까지는 충족하지 않는다.** 승인 SPEC는 홈 개인 필터로 범위를 적었다. | **부분 구현.** 홈 조합 실행 미검증; 개인 페이지 필터는 원요청 기준 누락. |
| **AC7** 이름/비밀번호만 수정 | `components/auth/AccountSettings.tsx:32,62`는 본인 프로필 이름 업데이트와 Auth 비밀번호 갱신을 호출한다. 이메일 편집 필드가 없다. `rls_and_role_helpers.sql:551–554,703`은 프로필의 본인 display_name 업데이트만 허용한다. `application_schema.sql:6–15`의 공개 profile에는 비밀번호·이메일이 없다. | **정적 구현 확인; 타인 접근과 실제 수정 미검증.** |
| **AC8** 루트 Next 빌드와 핵심 플로우 | `package.json:7–9`는 Next 실행/빌드 스크립트, `app/`에는 인증·홈·식당/메뉴·관리·개인 목록 화면이 있다. `components/admin/MenuEditor.tsx:170`와 `ReviewCard.tsx:169`는 사진 UI를 연결한다. | **미통과/보류.** 전체 빌드가 리소스 부족으로 끝나지 않았고 실제 로컬 플로우가 미실행이다. |
| **AC9** 공개 테이블/Storage 최소 권한 | `application_schema.sql:281–293`는 공개·private 테이블 RLS, `rls_and_role_helpers.sql:549–725`는 행 정책과 열별 grant, `20260925130002_initial_storage_policies.sql:12–40`은 객체 정책을 정의한다. `20260926130000_storage_upload_lifecycle.sql:84–130`은 삭제 대기 흐름을 추가한다. | **SQL 작성 확인; migration 적용·직접 API 우회 검사 미검증.** 독립 보안 검토도 별도 완료해야 한다. |
| **AC10** 기존 데이터 보존·충돌 보고 | `scripts/migrate/export-spring-data.ts:221–303`은 원본 추출/manifest, `import-supabase.ts:202–203,305–364,551–563,733–766`은 digest/정확 일치/충돌 중단, `verify-supabase-import.ts:65–126`은 관계·행 대조를 구현한다. `import-media.ts:152–231,403–425,491–615`는 ZIP 검증, 정확 일치 건너뛰기, byte/SHA 확인 후 연결을 둔다. | **스크립트 정적 확인; source/target 행 수, 재실행, 사진 해시, 실제 이관 모두 미검증.** ZIP 40장 미리보기만 확인됐다. |
| **AC11** Production 변수·비밀 미노출·연결 유지 | `lib/supabase/browser.ts:6–15`는 publishable 변수, `lib/supabase/admin.server.ts:1–12`는 server-only secret 변수, `proxy.ts:5–16`은 SSR publishable 변수를 사용한다. 현재 검토 범위에서 저장소/연결 설정 변경 코드는 확인되지 않았다. | **부분 정적 확인.** 전체 secret scan, 빌드/런타임 로그, Hybrid 기록 검사 및 Vercel 변수 이름·scope·presence는 미검증. 운영 값은 읽지 않았다. |

## 해결해야 할 확인 단계

1. AC1 전체 별점 재클릭 해제와 AC6 개인 페이지 필터 범위를 구현하고 이 표를 다시 대조한다.
2. C: 공간과 Docker 문제를 해결한 뒤 disposable local Supabase에 신규 migration만 적용하고 재적용/충돌·권한 거부를 확인한다.
3. 로컬 계정으로 리뷰·좋아요·찜·관리·사진 및 ZIP 40장 import의 건수/관계/SHA를 확인한다. 원본 ZIP과 Spring 데이터는 보존한다.
4. 전체 Next 빌드를 완료하고 실제 화면의 모든 조작을 역할별·화면 크기별로 기록한다.
5. 별도 보안 검토, secret scan, hosted 운영 preflight 증거가 준비될 때까지 AC9–11과 운영 cutover를 통과로 처리하지 않는다.

**독립 판정:** 현재는 정적 구현 근거가 상당하지만 AC1에 확인된 동작 누락이 있고 AC6은 원요청 범위와 차이가 있다. 전체 빌드, DB/RLS, ZIP import, 버튼별 QA가 끝나지 않아 Task09 및 요청된 코드 push의 완료 gate를 통과하지 않았다.

## 2026-09-26 미디어 보안 최종 슬라이스 독립 확인

- Hybrid 실행: `yum-review-media-final-verifier-20260926`
- 검증 작업: `media-final-independent-verification-20260926`
- 실행 주체: `media_final_verifier_20260926` (framework-logical actor)
- 연결된 dispatch 결정: `decision-df2f31283d97dc4e640369d94b461faf1935562c2cbcdef4dfc106cc420eaf40`
- 방법: 현재 route, server helper, password UI/proxy, 관련 SQL migration과 운영 문서를 읽기 전용으로 대조했다. 앱·migration 파일을 변경하지 않았으며 `.env*`와 hosted 서비스에 접근하지 않았다.

| 수용 기준 | 정적 근거 | 판정 |
| --- | --- | --- |
| 요청 JSON 본문 제한 | `lib/server/read-bounded-json.server.ts`는 Content-Length를 먼저 검사하고, 스트림 누적 크기를 지정 상한(미디어 2,048바이트, 비밀번호 4,096바이트) 안에 제한하며 크기 초과 시 취소한다. 두 API route는 이 helper를 사용한다. | **정적 확인.** 요청 런타임에서 실제 400/413 및 스트림 취소 동작은 미실행. |
| 서버 HMAC 설정 + Vault 키 일치 확인 후 다운로드 | `lib/media/verify-proof.ts`는 키 ID 형식, 표준 Base64, 32바이트 이상을 검증한다. `app/api/media/verify/route.ts`는 사용자 인증 후 로컬 설정과 owner/PENDING intent를 확인하고 `verify_media_validation_key` RPC의 일치 결과를 받기 전에는 Storage 다운로드를 호출하지 않는다. `20260926173000_media_verification_budget_and_key_preflight.sql`의 RPC는 해당 사용자 소유 PENDING 행과 Vault 키를 확인하고 비교 boolean만 반환한다. | **정적 순서·코드 확인.** 실제 환경변수/Vault 값 일치와 Vault 접근 권한은 미확인. |
| 사용자별 5회/60초와 전역 2개 슬롯/90초 | 미디어 route는 한 번의 `claim_media_verification_slot` 호출에 의존한다. `20260926173000_media_verification_budget_and_key_preflight.sql`은 advisory transaction lock 아래 사용자별 60초 quota, 활성 lease 2개 한도, 90초 만료 및 예측 불가 lease token을 처리하고 release RPC는 token digest·사용자·media ID를 함께 확인한다. `20260926172000_media_verification_rate_limit.sql`에는 별도 5/60초 RPC도 있다. route는 별도 quota RPC 대신 combined claim을 사용한다. | **정적 확인.** SQL 적용, 동시성·쿼터·lease 만료/release 실험은 미실행. |
| caller JWT로 본인 Storage 객체 다운로드 | route는 세션 사용자의 JWT를 보유한 Supabase server client의 Storage `download(object_path)`를 사용한다. service-role Storage client는 이 경로에 쓰이지 않는다. 선행 intent/claim RPC는 소유자와 PENDING 상태를 검사한다. | **정적 확인.** Storage RLS 적용 및 타인 경로 거부는 미실행. |
| APNG 및 다중 페이지 이미지 차단 | `app/api/media/verify/route.ts`는 PNG chunk 경계를 제한적으로 읽어 첫 IDAT 전 `acTL`을 거부하고 pre-IDAT parser work 상한도 둔다. Sharp는 `animated: true`, pixel limit, warning fail-closed 설정으로 호출되며 `metadata.pages > 1`을 거부하고 `stats()`로 디코딩한다. | **정적 확인.** Sharp/실제 APNG·WebP 파일 fixture 검증은 미실행. |
| 실제 저장 바이트와 증명된 활성화 | route는 다운로드 크기, DB intent의 stored_bytes, 응답 객체 크기를 대조하고 실제 bytes SHA-256과 속성을 포함한 짧은 HMAC proof를 만든다. `20260926170000_trusted_media_proofs_and_password_gate.sql`의 활성화 RPC는 Vault HMAC, 만료, 소유자/PENDING, object path/type/크기, Storage metadata size를 확인하고 nonce를 1회 소비한 뒤 ACTIVE로 바꾼다. | **정적 확인.** SQL·Storage metadata의 실제 모양, nonce replay, 연결/공개 정책은 미실행. |
| 강제 비밀번호 변경 gate | `proxy.ts`는 검증된 Auth claims 뒤 gate RPC를 확인해 강제 변경 페이지/API 외 경로를 리다이렉트한다. UI와 `app/api/account/legacy-password-change/route.ts`는 현재 비밀번호 재인증, 새 비밀번호 최소 길이와 기존 값 재사용 거부, Auth 업데이트 후 server-only service key로 marker clear를 수행한다. `20260926150000_legacy_password_change_gate.sql`은 테이블 write trigger와 Storage restrictive policy를 정의한다. 후속 trusted-proof migration은 이전 Auth hash trigger를 제거한다. | **정적 확인.** 실제 Auth 세션 변경, 서비스 키 scope, 정책 적용/우회 거부는 미실행. |
| 원본 업로드 전 크기 주장 | `original_bytes`는 업로드 intent에서 받은 사용자 제공 크기 정보이며, direct Storage 업로드 후 서버는 이미 저장된 객체의 실제 바이트 크기를 독립 확인한다. 이 흐름은 이미지 최적화 이전 원본 파일 크기를 서버에서 증명하지 않는다. 브라우저 제한은 별도 보호층이다. | **제한 사항 유지.** 원본 크기의 독립 서버 보증으로 간주하지 않는다. |
| migration/DB/PostgREST/RLS/Storage/Vault/Auth, build, 브라우저 QA, 배포 리소스 설정 | 이번 작업 환경에서는 로컬 disposable Supabase/Docker를 실행할 수 없고, 이 작업은 해당 명령/서비스를 실행하지 않았다. hosted 환경도 접속하지 않았다. | **차단/미실행.** 코드 정적 확인만으로 통과 처리하지 않는다. |

**슬라이스 판정:** 요청된 미디어·비밀번호 보안 구조는 정적 코드와 migration에서 확인했다. 실제 SQL 적용, Vault/RLS/Storage/Auth 동작, 이미지 decoder, 배포의 함수 자원 제한과 UI 버튼 QA는 증거가 없어 미검증 상태다. 이 결과는 구현·운영 전체 완료 승인이나 배포 승인으로 해석하면 안 된다.
