# 독립 구현 검증 — Next.js·Supabase 전환

- 검증 역할: 기능 구현에 참여하지 않은 독립 verifier
- Hybrid 실행: `yum-review-next-implementation-foundation-20260925` / `09-independent-verification-static-20260926` / `logical-verifier-final-20260926`
- 계획 결정: `decision-befaf0a00269fff7fde07d82123d684fbc60b8bdd9e091aa13381ce564669319`
- 계획 스냅샷: `570c1d6205bdd2c3d06a7a6ef667f9b2b0a7e637a7245852bf8a6aacd2284712`
- 방법: 승인된 SPEC/PLAN, 현재 소스·SQL·이관 스크립트와 Hybrid 구현자 보고를 읽기 전용으로 대조했다. 이 보고서 자체가 DB 정책 또는 UI 실제 동작의 실행 증거는 아니다.

## 현재 검증 수준

| 관찰 | 결과와 한계 |
| --- | --- |
| TypeScript | Lead가 이번 turn에서 `npx tsc --noEmit`를 실행해 exit code 0을 관찰했다. 본 verifier는 별도로 재실행하지 않았다. 이는 AC8의 부분 판정을 바꾸지 않는다. |
| 루트 빌드 | 후속 검증 기록의 `npm run build`가 loopback 전용 설정으로 컴파일·TypeScript·정적 생성·라우트 최적화를 완료했다. 이전의 힙/디스크 공간 실패는 이후 통과 실행으로 대체되었으며, 이는 hosted 설정이나 배포 확인은 아니다. |
| 사용자 ZIP | 리드의 읽기 전용 미리보기 결과 40장, 원본 이미지 합계 11,576,811바이트. 로컬 DB 등록 또는 Storage 업로드 증거는 없다. |
| 로컬 Supabase | 기존 로컬 DB를 초기화하지 않고 12개 migration 적용 및 재적용, 합성 사용자 기반 RLS·역할 RPC·Storage lifecycle·사진 제한 검증이 후속 runtime 기록에 있다. 이 verifier는 해당 실행을 재현하지 않았다. |
| 실제 화면 및 권한 | member 단일 세션에서 선택 화면 조작 및 별 반쪽 포인터 재검사가 기록돼 있다. 역할별·해상도별 57개 전수 QA, 업주/서버 관리자 UI 성공 흐름, 긍정 Vault/HMAC 이미지 확인은 미완료다. |
| 운영 환경 | hosted Supabase/Vercel 값·범위·데이터에 접근하지 않았다. 실제 데이터 이관, 운영 인증·메일·Storage 확인은 미실행. |

Hybrid 구현자 보고는 구현 범위의 이력을 제공할 뿐 독립 실행 증거를 대신하지 않는다. 후속 local runtime 및 브라우저 기록은 각 표에 별도로 인용했으며, 정적 검토·작업자 자기보고만으로 runtime 판정을 올리지 않았다.

## 수용 기준 AC1–AC11

| 기준 | 정적 근거 | 판정 |
| --- | --- | --- |
| **AC1** 다섯 별의 반쪽 입력, 재클릭 해제, 0.5 평균 | `components/reviews/ReviewForm.tsx:75–140`은 5개 별 모양의 좌/우 반쪽 radio를 둔다. `supabase/migrations/20260925130000_application_schema.sql:108–115`는 0.5 간격을 제약하고, `20260925130001_rls_and_role_helpers.sql:789–792`는 산술 평균을 계산한다. [`ui-qa-matrix.md`](../../../docs/migration/ui-qa-matrix.md)의 2026-09-26 포인터 회귀 재검사는 인증 member 수정 폼에서 좌측 0.5, 우측 1.0, 같은 1.0 재클릭 시 미평가/선택 해제를 관찰했고, 5.0 복구 후 취소했다. | **포인터 입력·해제 PASS; DB가 0.5를 저장/집계하는 전용 UI 회귀는 별도 evidence와 구분한다. 전체 AC는 부분 통과.** |
| **AC2** 전체 필수·세부 선택·미평가 | `ReviewForm.tsx:172–180`은 전체 필수만 검사하고 `:154–158`은 세부 null을 허용한다. SQL `application_schema.sql:99–115`의 전체 NOT NULL/세부 nullable과 집계 `rls_and_role_helpers.sql:789–792`의 `avg`가 대응한다. `ReviewCard.tsx:138–164`는 미평가 표기를 둔다. UI 연속 QA에는 선택 세부 점수와 미입력 항목을 둔 리뷰 저장 및 빈 코멘트 경로가 기록돼 있다([`ui-qa-matrix.md`](../../../docs/migration/ui-qa-matrix.md)); 평균은 정수 점수 합성 리뷰로 검증됐다. | **구현 및 선택 입력 UI 경로 확인; 0.5 점수 저장·집계의 실제 회귀는 미확인.** |
| **AC3** 사진 권리 동의 제거, 비이벤트 동의 유지 | `ReviewForm.tsx:176–180,239–246`, `lib/data/reviews.ts:99–117`, `rls_and_role_helpers.sql:603–622`에 새 리뷰 비이벤트 동의가 있다. `ImageUpload.tsx:149–210`에는 사진 권리 체크가 없다. UI 연속 QA는 비이벤트 동의 없이 제출하는 검증과 동의 후 작성 경로를 기록했다. 사진 권리 체크의 실제 업로드 UI 경로는 정적 확인만 있다. | **리뷰 동의 UI 경로 확인; 메뉴/리뷰 사진 업로드는 미검증.** |
| **AC4** 홈 문구/로고/반응형 | `app/page.tsx:40–44`의 설명형 배너, `components/site/BrandMark.tsx:10–24`와 `public/brand/hanip-mark.svg`가 있다. 현 홈 소스에는 `closing-note`/`기록의 기준` 문구가 없다. | **정적 구현 확인; 모바일·데스크톱 시각 QA 미검증.** |
| **AC5** 타인 리뷰 좋아요 | `ReviewCard.tsx:103–133,185–194`, `lib/data/likes.ts:65–92`에 토글과 본인 버튼 숨김이 있다. `application_schema.sql:196–202`는 사용자·리뷰 복합 기본키, `rls_and_role_helpers.sql:662–677`은 본인 행·타인 공개 리뷰 조건을 둔다. member UI의 좋아요/취소와 합성 anon·authenticated 정책 검사는 runtime 기록에 있다. | **선택 UI 토글과 일부 로컬 RLS 조건 확인; 직접 API 전체 거부 조합은 부분 검증.** |
| **AC6** 찜/개인 필터와 검색·종류·지역·거리·정렬 조합 | `lib/data/wishlists.ts:7–57`, `PersonalFilters.tsx:24–45`, `DiscoveryFilters.tsx:89–100`, `lib/data/catalog.ts:389–412`, `app/my-reviews/page.tsx`, `app/wishlist/page.tsx`가 개인 목록과 필터 경로를 구성한다. 승인 SPEC 수용 기준 6은 `내 리뷰`와 `찜한 메뉴` 필터를 명시하고, PLAN은 홈·내 리뷰·찜 목록 각각의 조건 조합과 URL 복원을 명시한다. 최신 member 관찰은 `/my-reviews`의 exact/no-match 검색, 종류·지역·taste 정렬 조합, 1km 좌표 누락 제외, 조건 제거 복원 및 menu detail 간 Back/Forward 상태 복원을 확인했다. `/wishlist`는 찜 0건이라 검색 URL·히스토리 기제만 관찰됐으며 결과 정렬·종류·지역 조합 의미는 확인하지 못했다([`ui-qa-matrix.md`](../../../docs/migration/ui-qa-matrix.md#2026-09-26-member-개인-필터-직접-관찰-보충)). | **부분 확인. 구현과 제한된 UI 증거는 있으나 빈 찜 데이터에서는 결과 조합을 확인할 수 없었고 다수 실결과의 정렬 순위·전체 조합도 미검증이다. AC6 PASS가 아니다.** |
| **AC7** 이름/비밀번호만 수정 | `AccountSettings.tsx:32,62`는 본인 표시 이름 및 Auth 비밀번호 갱신을 호출하고 이메일 편집 필드는 없다. `rls_and_role_helpers.sql:551–554,703`은 본인 display_name만 허용한다. UI matrix에는 이름 저장 후 원복이 기록됐고, 비밀번호는 빈 제출 검증만 됐다. | **이름 UI 수정 경로 PASS; 비밀번호 변경 및 타인 데이터 접근 거부는 미검증.** |
| **AC8** 루트 Next 빌드와 핵심 플로우 | `package.json:7–9`는 Next 실행/빌드 스크립트, `app/`에는 인증·홈·식당/메뉴·관리·개인 목록 화면이 있다. `MenuEditor.tsx:170`와 `ReviewCard.tsx:169`는 사진 UI를 연결한다. [`signed-url-refresh-verification.md`](../../../docs/migration/signed-url-refresh-verification.md)는 loopback 설정의 `npm run build` 성공을 기록한다. 선택한 member 조작 경로는 UI matrix에 기록돼 있다. | **빌드 PASS; 핵심 화면 일부 확인. 전체 역할·뷰포트 플로우는 부분 검증.** |
| **AC9** 공개 테이블/Storage 최소 권한 | `application_schema.sql:281–293`는 공개·private 테이블 RLS, `rls_and_role_helpers.sql:549–725`는 행 정책과 grant, `20260925130002_initial_storage_policies.sql:12–40`은 Storage 정책을 정의한다. `local-runtime-verification.md`는 12개 migration 적용/재적용 및 합성 role/RLS/Storage lifecycle 검사를 기록한다. | **로컬 SQL/runtime 일부 PASS; 모든 직접 API 우회·정책 조합과 independent security gate 완료 여부는 미확인.** |
| **AC10** 기존 데이터 보존·충돌 보고 | `scripts/migrate/export-spring-data.ts:221–303`은 원본 추출/manifest, `import-supabase.ts:202–203,305–364,551–563,733–766`은 digest/정확 일치/충돌 중단, `verify-supabase-import.ts:65–126`은 관계·행 대조를 구현한다. `import-media.ts:152–231,403–425,491–615`는 ZIP 검증, 정확 일치 건너뛰기, byte/SHA 확인 후 연결을 둔다. | **스크립트 정적 확인; source/target 행 수, 재실행, 사진 해시, 실제 이관 모두 미검증.** ZIP 40장 미리보기만 확인됐다. |
| **AC11** Production 변수·비밀 미노출·연결 유지 | `lib/supabase/browser.ts:6–15`는 publishable 변수, `lib/supabase/admin.server.ts:1–12`는 server-only secret 변수, `proxy.ts:5–16`은 SSR publishable 변수를 사용한다. 이번 검증은 저장소 연결이나 hosted 값을 읽지 않았다. | **정적 구조만 일부 확인.** 전체 secret scan, 런타임 로그, Hybrid 기록 검사 및 Vercel Production 변수 이름·scope·존재는 미검증. Hosted 작업은 수행되지 않았다. |

## 해결해야 할 확인 단계

1. 남은 57개 역할·화면 크기 UI 회귀 행을 끝까지 확인하고 owner/server-admin 성공 흐름, 이미지 업로드, 뒤로/앞으로, 지오로케이션 성공, 다양한 검색·정렬 데이터 비교를 기록한다.
2. 사진 positive Vault/HMAC 및 HTTP image verification 흐름을 synthetic local validation key와 fixture로 검증한다.
3. 실제 source/target 데이터 이관과 ZIP 사진 건수·관계·SHA 검증은 수행 증거가 없어 미완료다.
4. AC6에서 아직 확인하지 못한 `/wishlist`의 비어 있지 않은 데이터 정렬·종류·지역 조합 의미와 여러 결과의 정렬 순위를 검증한다. 승인 범위에는 `내 리뷰`와 `찜한 메뉴`가 이미 포함돼 있다.
5. 전체 secret scan 및 hosted Production 환경 preflight는 별도 승인·증거가 준비되기 전까지 미완료로 유지한다.

**독립 판정 (2026-09-26 evidence 반영):** stale AC1 실패 기록은 현재 소스와 pointer regression 증거로 정정했다. 반쪽 입력·재클릭 해제의 UI 동작은 PASS이며, 0.5 입력의 저장/집계 및 전체 57개 역할·뷰포트 acceptance는 아직 완료되지 않았다. 빌드와 로컬 migration/RLS의 일부 검사는 PASS 기록이 있으나, 데이터 이관, 사진 positive HMAC, 전체 역할 UI QA, hosted 환경 확인은 미완료다. Task 09는 PARTIAL이며 push 완료 gate를 통과하지 않았다.

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
| migration/DB/PostgREST/RLS/Storage/Vault/Auth, build, 브라우저 QA, 배포 리소스 설정 | 로컬 12-migration 적용·일부 RLS/Storage 합성 검증, loopback build, member UI 일부 조작은 후속 runtime 기록에 있다. 긍정 Vault/HMAC 이미지 route와 hosted 환경은 확인하지 않았다. | **로컬 일부 PASS; 긍정 미디어 경로 및 hosted 설정은 미실행.** |

**슬라이스 판정:** 미디어·비밀번호 보안 구조의 정적 근거와 일부 local SQL/RLS/Storage 실행 증거가 있다. 긍정 Vault/HMAC 이미지 route, Sharp 실파일 decoder 검증, hosted 설정과 배포 자원 확인은 미완료다. 이 결과는 구현·운영 전체 완료 승인이나 배포 승인으로 해석하면 안 된다.

## 2026-09-26 AC6 독립 문서 확인 보충

승인 SPEC 수용 기준 6은 `내 리뷰`와 `찜한 메뉴` 필터를 명시하며, PLAN은 홈·내 리뷰·찜 목록 각각의 검색/종류/지역/거리/정렬 조합과 URL 상태 복원을 요구한다([`SPEC`](SPEC.md#수용-기준), [`PLAN`](PLAN.md#수용-기준)). 따라서 이전 기록의 AC6 범위 모호성 주장은 사실과 달라 정정했다. 최신 [`Lead CUA 관찰`](../../../docs/migration/ui-qa-matrix.md#2026-09-26-member-개인-필터-직접-관찰-보충)에 따르면 `/my-reviews`에서 `QA 사진 메뉴` exact 검색은 1건, `qa-no-match-20260926`는 0건을 반환했고, `category=KOREAN`, `region=죽전`, `sort=taste`, `mineReviews=1` 조합은 1건을 반환했다. 반경 1km는 좌표 없는 식당을 제외했고 반경 제거는 1건을 복원했다. 해당 상태에서 메뉴 상세로 이동한 뒤 Back은 필터 URL·폼·1건 결과를 복원했고 Forward는 상세로 이동했다. `/wishlist`는 찜 0건이어서 `qa-wishlist-no-match-20260926` 검색, `wishlistedOnly=1` URL, Back/Forward, 초기화 시 q 제거와 route 의미 유지만 관찰됐다. 결과 데이터가 없어 찜 목록 정렬 또는 실결과의 종류·지역 조합 의미는 확립되지 않았다.

이 verifier는 증거 문서와 구현을 독립적으로 대조했으며 CUA 브라우저 조작을 직접 수행하지 않았다. AC6 구현/UI 증거는 **PARTIAL**이고 전체 Task 09도 **PARTIAL**이다. 전체 역할·viewport matrix, admin/owner UI, 활성 media-proof route, direct API 조합, 데이터 이관 및 hosted 확인은 해결되지 않았다. 이 기록은 전체 UI QA 완료나 push를 승인하지 않는다.
