# Next.js·Supabase 독립 보안 검토

검토일: 2026-09-26  
범위: `app/`, `components/`, `lib/`, 신규 Supabase SQL migration, 로컬 이관 스크립트의 정적 소스.  
방법: 작성자와 분리된 소스 검토. 데이터베이스 migration, 호스팅 서비스 접근, 빌드·런타임 테스트는 수행하지 않았다.

## 판정

**보안 승인 보류.** 아래 높은 위험 두 건을 수정하고 로컬 disposable Supabase에서 직접 API 호출로 재검증해야 한다. 운영 데이터 이관과 공개 쓰기 활성화는 독립 런타임 검증 및 별도 운영 gate 전까지 보류한다.

## 발견 사항

| ID | 위험도 | 근거와 영향 | 수정·재검증 조건 |
| --- | --- | --- | --- |
| S1 | 높음 · 공개 업로드 차단 | `public.create_media_upload_intent`는 요청자가 보낸 MIME·크기를 메타데이터로 기록하고, `public.activate_media_upload`는 동일 경로의 Storage 객체 **존재 여부**만 확인한다 (`supabase/migrations/20260925130001_rls_and_role_helpers.sql:807–921`). 서명·디코딩·실제 바이트 수·해시 검사는 브라우저 코드 (`lib/media/validate-image.ts`, `lib/media/storage.ts`)에만 있다. 로그인 사용자가 직접 RPC/Storage API를 호출하면 브라우저 검사를 우회해 선언값과 다른 바이트를 ACTIVE로 연결할 수 있다. `allowed_mime_types`는 전송 MIME 제한이며 실제 이미지 검증을 증명하지 않는다. | ACTIVE 전환 전 신뢰 가능한 서버 측 바이트 검증 절차를 두고, 선언 크기·실제 크기·이미지 시그니처·디코딩·해시를 대조한다. 일반 사용자의 임의 객체를 검증 전 공개 연결하지 못하게 한다. JPEG/PNG/WebP로 위장한 비이미지와 크기 불일치 파일의 직접 API 우회 요청이 거부되는지 로컬에서 확인한다. |
| S2 | 높음 · 기존 계정 운영 전환 차단 | 이관은 `private.legacy_user_identity.legacy_must_change_password`를 보존한다 (`supabase/migrations/20260925130000_application_schema.sql:35–44`, `scripts/migrate/import-supabase.ts:578–580`). 그러나 `lib/auth/guards.ts`, 로그인·계정 설정 및 쓰기 경로에는 이 표식을 읽거나 비밀번호 변경 전 접근을 제한하는 절차가 없다. 확인 메일을 마친 기존 강제 변경 대상은 기존 비밀번호로 일반 기능과 관리자 권한을 사용할 수 있다. | 이관 계정의 강제 변경 상태를 서버가 확인하고, 완료 전에는 비밀번호 변경 화면 외 경로·RPC 쓰기를 제한한다. 성공적인 변경 후에만 신뢰 가능한 서버 경로로 표식을 해제한다. 기존 관리자와 일반 회원 합성 계정 모두에서 직접 API 우회까지 검증한다. |
| S3 | 보통 · 공개 API 남용 가능성 | `app/api/location/search/route.ts`는 비로그인 요청을 받아 NAVER 검색 키로 요청한다. 검색어 길이·응답 개수·시간 제한은 있으나 호출 빈도 제한은 없다 (`lib/data/location.ts:60–116`). 키가 설정되면 외부에서 반복 호출하여 할당량을 소진할 수 있다. | 배포 전 IP/사용자 기준 호출 제한과 초과 응답을 추가하고, 과다 요청 시 NAVER 호출이 발생하지 않는지 확인한다. 키 미설정 상태의 안내 동작은 유지한다. |
| S4 | 보통 · 삭제 직후 링크 유효기간 확인 필요 | 공개 사진은 60초짜리 서명 URL을 브라우저에서 발급한다 (`lib/data/media.ts:3–60`). 연결 해제는 SQL 정책에서 새 URL 발급과 일반 객체 읽기를 중단하도록 설계되어 있다. 이미 발급한 서명 URL이 연결 해제 후에도 만료까지 읽히는지 여부는 이 정적 검토로 확인할 수 없다. 즉시 접근 폐기를 보장한다는 코드 주석·사양과 최대 60초 유효기간 사이에 검증 공백이 있다. | 로컬 Storage에서 삭제 전 발급한 URL을 삭제 직후 다시 요청해 실제 동작을 확인한다. 잔여 접근이 가능하면 사용자 안내·사양에 상한을 명시하고 더 짧은 TTL 또는 접근 프록시 설계를 결정한다. |

## 정적 검토에서 확인한 방어

- SSR 페이지와 Server Action은 `supabase.auth.getUser()` 및 `get_my_access`로 현재 요청의 신원을 다시 확인한다. 서버 관리자·식당 업주 관리 화면 모두 서버 가드를 사용하고, 역할의 원천은 클라이언트 메타데이터가 아닌 private 원장이다 (`lib/auth/guards.ts`, `app/admin/page.tsx`, `app/restaurants/[id]/manage/page.tsx`).
- 운영자 지정 RPC는 함수 내부에서 서버 관리자 여부를 검사한다. 메뉴 쓰기와 타인 리뷰 삭제도 RLS로 제한되고, 일반 사용자의 리뷰·좋아요·찜 행에는 사용자 ID 정책이 있다 (`supabase/migrations/20260925130001_rls_and_role_helpers.sql:549–691`, `923–1008`). 실제 권한 거부는 아직 실행 검증 전이다.
- 비밀 키 클라이언트는 `server-only` 모듈에 있고 현재 확인한 일반 화면에서는 Auth 사용자 UUID 목록을 읽는 관리 화면에만 사용된다. 화면의 데이터 변경은 호출자 JWT로 RPC/테이블 정책을 통과한다 (`lib/supabase/admin.server.ts`, `app/admin/page.tsx`). 브라우저 모듈에서는 공개용 키만 사용한다.
- 새 Storage bucket은 비공개이며 활성 자산과 현재 연결된 메뉴·리뷰만 공개 SELECT를 허용한다. 업로드 경로는 인증 UUID·랜덤 자산 UUID와 일치해야 한다. 첨부·삭제 트리거는 자산 행 잠금과 연결 확인을 수행하고, 후속 migration은 연결 해제 자산의 물리 삭제에 7일 유예를 둔다 (`supabase/migrations/20260925130002_initial_storage_policies.sql`, `20260926130000_storage_upload_lifecycle.sql`). 실제 RLS·TUS 동작은 로컬 검증 대상이다.
- 로컬 이관 스크립트는 쓰기 플래그와 loopback URL·고정 로컬 포트 검사를 요구한다. 원본 사진과 ZIP은 읽기 경로로 다루며, 사진은 체크섬을 비교한 후 로컬 Storage에 저장한다. 출력 메시지는 원본 비밀값 대신 요약 상태만 사용한다 (`scripts/migrate/import-supabase.ts:227–279`, `scripts/migrate/import-media.ts:49–109`, `482–619`, `766–889`). 이 가드는 운영 환경에 대한 이 스크립트의 실행을 허용하지 않는다.
- 로그인 return 경로는 같은 출처 내부 경로만 수용하고, 역슬래시·제어 문자를 거부한다 (`components/auth/safeReturnTo.ts`). 권한 판단에 쿠키 문자열만 쓰지 않고 proxy에서 JWT claims를 갱신하며 캐시 금지를 설정한다 (`proxy.ts`).

## 아직 증명되지 않은 조건

- SQL migration 적용 성공, 실제 PostgREST grants/RLS, 익명·회원·업주·서버 관리자 간 직접 API 거부, Storage 서명 URL의 해제 직후 동작, TUS 재시도는 이 검토에서 실행하지 않았다. 독립 로컬 검증과 버튼별 QA 결과를 받아 재판정해야 한다.
- Hosted Auth의 기존 BCrypt 해시 호환성, 이메일 확인·재인증 설정, Production 키 범위, Storage 요금제 한도, 운영 원본·대상 행 수량은 별도 비파괴 운영 preflight가 필요하다. 이 문서에서는 호스팅 설정이나 비밀값을 조회하지 않았다.

## 재검토 결과

초회 정적 검토: S1·S2 미수정, S3·S4 미검증. **승인 보류.** 수정 뒤 독립 검토자가 직접 API와 로컬 Storage 증거를 확인하여 이 절을 갱신한다.

## 2026-09-26 재검토 — S2–S4 및 S1 상태

**판정: 보안 승인 보류.** 신규 강제 비밀번호 변경 흐름과 제한 기능을 소스에서 재검토했다. 정적 검토만 수행했으며 migration, Postgres/RLS, Storage, NAVER/Upstash 연결, 빌드·브라우저 테스트 및 hosted 서비스를 실행하거나 조회하지 않았다.

| ID | 재검토 상태 | 근거와 남은 조건 |
| --- | --- | --- |
| S1 | **미해결 · 높음** | 이번 추가 migration은 업로드 완료 함수를 교체하지 않는다. `public.activate_media_upload`는 여전히 선언된 `content_type`·크기를 실제 객체와 대조하지 않고 Storage 객체의 경로 일치 존재 여부만 확인한 뒤 `ACTIVE`로 바꾼다 (`20260925130001_rls_and_role_helpers.sql:881–921`). Storage의 MIME/크기 한도는 선언 MIME의 유효성이나 실제 이미지 바이트 디코딩을 증명하지 않는다. 직접 Storage/RPC 호출로 내용이 다른 파일을 연결할 수 있는 경로가 남아 있다. 신뢰 가능한 실제 바이트 검사와 위조 MIME/크기 우회 거부의 로컬 직접 API 검증이 필요하다. |
| S2 | **부분 개선, 미해결 · 높음** | 새 migration은 강제 변경 플래그 조회, 주요 공개 테이블의 쓰기 트리거, Storage restrictive policy, proxy/page 리디렉션을 추가한다 (`20260926150000_legacy_password_change_gate.sql:4–88, 124–128`, `proxy.ts:43–56`, `lib/auth/guards.ts:38–55`). 하지만 플래그 해제 조건은 `encrypted_password` 해시 값이 달라지는 것뿐이다 (`…gate.sql:97–120`). 화면은 새 비밀번호 8자 길이와 확인값만 검사하고 이전 비밀번호와 다른지 검사하지 않는다 (`components/auth/ForcePasswordChange.tsx:17–49`). 같은 기존 문자열을 다시 제출해도 Auth가 salt를 새로 생성해 저장 해시가 달라질 수 있으므로 플래그가 해제될 가능성을 배제할 수 없다. 같은 비밀번호 재설정을 Auth가 거부한다는 증거도 없다. 계정 비밀번호 변경 API로 같은 문자열을 제출하는 시도 및 Auth 동작을 격리된 로컬 환경에서 확인하고, 기존 비밀번호 재사용을 방지하는 강제 변경 절차를 확정해야 한다. 또한 이 gate는 일반 화면 탐색과 쓰기를 막지만 공개 읽기 정책의 직접 Supabase 조회까지 차단하는 설계는 아니다. |
| S3 | **코드 수준 완화 확인, 배포 설정 미확인** | NAVER 자격증명이 없으면 외부 호출 없이 설정 안내를 반환한다. 자격증명이 있으면 공유 Upstash 고정 창에서 IP당 60초 20회로 제한하고, limiter 환경변수/IP/Redis가 없거나 실패하면 NAVER 호출 전에 `503`으로 닫는다 (`app/api/location/search/route.ts:18–42`, `lib/security/location-rate-limit.server.ts:14–83`). 단, 실제 Vercel `x-real-ip` 신뢰성·Upstash 환경변수·한도 동작은 실행 확인하지 않았다. NAVER 키를 넣기 전에 해당 설정을 갖춘 뒤 로컬/Preview 환경에서 과다 요청이 외부 호출을 막는지 확인해야 한다. |
| S4 | **잔여 위험 명시, 즉시 해제 보장은 미검증 · 보통** | 모든 정적 서명 URL 경로는 TTL을 15초로 낮췄다 (`lib/data/media.ts:4, 48`, `lib/data/catalog.ts:105, 241`). 그러나 업로드 객체의 `cacheControl`은 3,600초다 (`lib/media/storage.ts:100, 202`). 보안 문서는 URL 만료와 브라우저 캐시를 구분해, 이미 받아 둔 바이트가 같은 기기에서 최대 1시간 재표시될 수 있음을 명시한다 (`docs/security/media-access-window.md`). 이는 새 서명 발급의 잔여 접근을 줄였지만 캐시된 사본의 즉시 숨김을 보장하지 않는다. 실제 Storage 응답/브라우저 캐시 및 detach 직후 기존 URL 재요청은 로컬에서 검증하지 않았다. 제품의 즉시 숨김 기준이 필요하면 cache-control을 짧은 서명 TTL에 맞추거나 `no-store`로 조정한 뒤 로컬 검증해야 한다. |

**검증 한계:** 모든 판정은 소스와 문서의 정적 대조다. 신규 SQL이 실제로 적용되는지, Auth가 동일 비밀번호 재설정을 어떻게 처리하는지, Storage의 서명 URL·캐시 헤더·RLS가 어떻게 동작하는지, 제한 경계에서 실제 외부 호출이 억제되는지 증명하지 않았다. Hosted Supabase/Vercel은 조회하거나 수정하지 않았다.

## 2026-09-26 독립 재검토 — 서명된 미디어 증명 및 강제 비밀번호 변경

**정적 소스 판정: 기존 S1·S2의 코드 경로 수정은 확인했다. 최종 보안 승인은 보류한다.** 검토 범위는 `app/api/media/verify/route.ts`, `lib/media/verify-proof.ts`, `lib/media/storage.ts`, `app/api/account/legacy-password-change/route.ts`, 인증 페이지·컴포넌트와 `proxy.ts`, 그리고 지정된 미디어/Storage/비밀번호 SQL migration 및 보안 문서다. 별도 작성자로서 소스만 읽었다. SQL을 적용하거나 직접 API/RLS/Auth/Storage를 실행하지 않았다.

| 항목 | 정적 검토 결과 | 남은 증거·조치 |
| --- | --- | --- |
| S1 — 업로드 활성화 우회 | **코드 수정 확인.** 새 `activate_media_upload(uuid,text,text)`는 인증된 호출자만 받고, 업로더 UUID·`PENDING` 상태·유효한 업로드 경로를 다시 검사한다. 실행 권한은 `authenticated`에만 주며 이전 1인자 함수는 제거한다 (`20260926170000...sql:13–130`). 새 `get_media_verification_intent`도 JWT `auth.uid()`와 `uploaded_by` 일치, `PENDING`, 현재 업로드 권한을 요구하고 필요한 다섯 필드만 돌려준다 (`20260926171000...sql:3–28`). 원본 테이블의 기존 클라이언트 SELECT 컬럼은 `id/object_path/media_kind/content_type/created_at`에 한정되어 있어 바이트 필드 권한을 넓히지 않는다 (`20260925130001...sql:693–727`). | PostgREST 실제 권한, 익명/타인 UUID 직접 RPC 거부, migration 적용을 disposable Supabase에서 확인해야 한다. 소스만으로 role grants/RLS 동작을 확정하지 않는다. |
| PENDING 객체 읽기 정책 | **소유자 전용으로 제한된 설계 확인.** 버킷은 비공개다. Storage SELECT는 활성 상태로 실제 메뉴/리뷰에 연결된 객체를 공개하고, 별도 uploader 정책은 `private.can_upload_media_path(name)` 또는 정리 대기 자산만 허용한다. helper는 경로 자산의 `uploaded_by = auth.uid()`, `PENDING`, 활성 대상과 현재 업주/리뷰 권한을 모두 요구한다 (`20260925130001...sql:149–179`; `20260925130002...sql:12–29`). 따라서 검증 API는 본인 대기 객체를 다운로드할 수 있지만 일반 사용자나 익명 사용자는 다른 소유자의 PENDING 바이트를 읽는 경로가 소스상 보이지 않는다. | Storage RLS/TUS 실제 SELECT·업로드 응답이 같은 권한 경계를 따르는지 로컬 직접 API로 확인해야 한다. 강제 비밀번호 변경 restrictive policy의 실제 교집합도 실행 미검증이다. |
| 서명 증명·필드 결속 | **정적 경로 일치 확인.** 서버 라우트는 호출자의 SSR 세션/JWT로만 의도를 읽고 Storage에서 해당 경로를 다운로드한다. `Buffer.length`, Blob 크기, 의도에 기록된 저장 바이트를 대조하고 Sharp 포맷/디코딩을 거친 뒤 실제 바이트 SHA-256과 `mediaId`, `objectPath`, 형식, 원본/저장 크기를 HMAC-SHA256으로 서명한다. DB는 원문 UTF-8 payload 그대로 HMAC을 검증한 다음 파싱 필드를 동일 자산 행과 대조하고 99,999,999-byte 한도를 적용한다 (`route.ts:29–118`, `verify-proof.ts:7–52`, `20260926170000...sql:37–112`). 재직렬화된 JSON을 비교하지 않지만 서명은 받은 원문 바이트열 자체에 걸리고 서명 생성은 서버 모듈만 수행하므로, 현재 구현에서 JSON canonicalization 불일치 우회는 확인되지 않았다. | HMAC/Vault가 실제 환경에서 맞는지 및 Postgres 인코딩 일치 여부는 실행 증명이 아니다. |
| TTL·nonce·재사용 | **정적 재생 방지 확인.** 서버가 UUID nonce와 시각을 매 요청 생성한다. SQL은 시각을 현재 기준 과거 60초/미래 10초로 제한하고, nonce PK와 proof digest UNIQUE를 가진 비공개 소비 테이블에 삽입한 뒤 자산 행 잠금 상태에서 `PENDING`을 `ACTIVE`로 바꾼다 (`verify-proof.ts:5,38–52`, `20260926170000...sql:5–10,77–125`). 활성화 후 동일 증명은 상태 조건에서 실패하고, 같은 nonce 또는 payload 중복도 유일 제약에 걸린다. | 동시 RPC/replay 거부와 migration의 유일 제약이 실제로 적용되는지는 로컬에서 확인해야 한다. |
| Storage 크기 metadata 신뢰 | **metadata만으로 검증하지 않는 설계 확인.** SQL은 `storage.objects.metadata->>'size'`를 HMAC의 저장 크기와 추가 대조한다 (`20260926170000...sql:105–112`). 핵심 크기는 API가 실제로 내려받은 객체의 바이트 길이를 서버가 재측정해 proof에 서명하며, SQL metadata가 단독으로 ACTIVE 판정을 만들지는 않는다. Storage 문서도 `storage.objects.metadata`를 객체 metadata로 설명한다 ([Supabase Storage schema](https://supabase.com/docs/guides/storage/schema/design)). `original_bytes`는 클라이언트가 업로드 intent를 만들 때 신고한 원본 파일 크기라 서버가 독립 측정한 값은 아니다. | 저장 객체 크기/API 응답과 Postgres metadata가 일치하는지 로컬 upload/TUS 사례로 검증한다. 최적화 전 원본 파일 크기 자체는 브라우저 밖에서 입증할 수 없다는 제한을 사용자 요구의 서버 강제와 혼동하지 않아야 한다. |
| Vault schema·privilege·키 준비 | **설정 gate 미검증.** SQL은 `vault.decrypted_secrets`에서 `yum-review-media-validation:<keyId>`를 조회하고, Vercel의 server-only HMAC key와 길이/Base64 형식 및 HMAC을 확인한다. migration은 Vault 확장/비밀값/역할 권한을 구성하지 않는다. Supabase 문서상 `vault.decrypted_secrets`는 평문을 반환하며 그 뷰 권한을 별도로 보호해야 한다 ([Supabase Vault](https://supabase.com/docs/guides/database/vault)). 현재 함수는 `SECURITY DEFINER`라 함수 소유 역할이 뷰를 읽을 수 있어야 하지만, `anon`·`authenticated`가 뷰를 읽지 못하는 실제 권한은 소스에서 증명할 수 없다. | 배포 전 비밀 값을 출력하지 않고 함수 소유 역할의 읽기 가능 여부와 anon/authenticated의 직접 SELECT 거부를 로컬에서 확인한다. Hosted Supabase/Vercel 값이나 비밀 환경 파일은 조회하지 않았다. |
| 키 누락·불일치 | **비공개 fail-closed 확인, fail-fast 미흡.** 서버 env 키/ID가 없으면 `createMediaVerificationProof`가 예외를 내고 라우트는 일반 503으로 끝난다. Vault 행이 없거나 잘못된 DB 키/서명은 activation 오류로 거부된다. 두 경우 모두 SQL의 상태 변경 전에 끝나 이미지가 공개되지 않는다. 다만 서버 env 키 확인이 다운로드와 Sharp `stats()` 후에 발생하므로, 잘못 구성된 서버에 인증 사용자가 반복 요청하면 최대 99,999,999-byte 다운로드와 디코딩 비용을 먼저 소비시킬 수 있다 (`route.ts:58–118`, `verify-proof.ts:17–31`). | 키 설정을 무비밀 상태 코드로 fail-fast 확인하고, 설정 전 라우트가 이미지 본문을 읽지 않는 것을 검증하는 편이 안전하다. |
| Forced password change | **기존 직접 Auth 우회는 정적 수정 확인.** 계정 라우트는 동일 origin POST만 수용하고, 현재 로그인 사용자를 재확인한 뒤 현재 비밀번호로 같은 이메일의 재인증을 하고 동일 UUID인지 검증한다. 현재 비밀번호와 같은 새 문자열은 거부한다. 사용자 JWT로 `updateUser`를 완료한 뒤에만 비공개 marker 상태를 읽고, marker가 필요한 경우 server-only key로 해당 세션 `user.id`만 RPC에 전달한다 (`route.ts:11–61`). 새 migration은 해시 변경 trigger를 제거하고 marker 해제 RPC를 `service_role`에만 주며 함수 안에서도 `auth.role()`을 요구한다 (`20260926170000...sql:132–155`). 일반 공개/비공개 테이블 쓰기 trigger, Storage restrictive policy, `proxy.ts`와 서버 페이지 가드가 변경 전 쓰기를 제한한다. 직접 `auth.updateUser`만 호출해도 marker를 지우는 경로는 현재 소스에 없다. | 암호 재인증/쿠키 갱신, 직접 Auth API 후에도 gate 유지, service-role RPC의 실제 권한·적용 범위는 격리된 local Auth/DB에서 실행 검증이 필요하다. 서비스 키가 노출되면 보호 경계를 우회할 수 있으므로 server-only 배포와 누출 시 회전 절차가 필요하다. 이메일/세션/CORS 동작도 런타임 확인 전이다. |
| 이미지 자원 제한 | **확인된 제한은 있으나 추가 방어 권고.** 서버는 Node runtime, 60초 duration, 99,999,999-byte 저장 상한, JPEG/PNG/WebP allowlist, Sharp `limitInputPixels: 40,000,000`, `failOn: 'warning'`, 실제 Buffer 크기 대조를 사용한다. 다만 Sharp metadata 결과의 `pages`/프레임 수를 검사하지 않는다. Sharp 문서상 다중 페이지/애니메이션 형식이 지원되고 기본 `pages` 값은 1이며, `metadata`는 헤더에서 빠르게 읽는다 ([Sharp input metadata](https://sharp.pixelplumbing.com/api-input/), [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/)). 따라서 현재 `stats()`가 WebP의 첫 프레임만 검사할 수 있어 저장된 애니메이션 전체를 완전 디코딩했다고 볼 수 없다. 라우트에는 업로드 검증 호출 제한/동시성 제한도 없고 `request.text()`로 본문 전체를 읽은 다음 2KB 상한을 적용한다. | `metadata.pages === 1`로 애니메이션을 거부하거나 모든 프레임 수/총 픽셀 예산을 제한하고, 본문을 제한된 스트림으로 읽기 전 크기 검사·호출 제한을 추가하는 방안을 검토한다. 40M px와 거의 100MB 입력의 실제 메모리·시간은 Vercel runtime/plan에서 확인하지 않았다. Sharp 문서도 비신뢰 입력의 CPU/메모리 상한을 별도 runtime에서 두도록 권한다 ([Sharp security](https://sharp.pixelplumbing.com/security/)). |
| S3·S4 이전 항목 | **이전 보고 유지.** 장소 검색은 Upstash/IP 제한과 fail-closed 코드를 갖지만 `x-real-ip`, Vercel/Upstash 설정 및 한도 동작은 검증하지 않았다. 사진 signed URL은 15초로 짧아졌으나 업로드 객체 `cacheControl`은 3,600초여서 이미 브라우저에 받은 사본이 남을 수 있다 (`docs/security/media-access-window.md`). | 기존 보안 검토의 해당 설정·캐시 조건을 disposable local/Preview에서 확인한다. |

**실행 한계와 최종 gate:** 현재 C: 및 G: 여유 공간이 각각 0.5GB 미만이고 Docker daemon을 사용할 수 없어 disposable local Supabase를 띄울 수 없다. 이 재검토에서는 SQL migration, DB/PostgREST direct API, Storage upload/TUS, Auth, 빌드, 테스트, 브라우저 QA를 하지 않았다. Hosted Supabase/Vercel에는 접근하지 않았다. 그러므로 위의 정적 수정은 **런타임 통과로 간주할 수 없으며**, 최소한 S1·S2 직접 권한/우회, Vault 접근 권한, 애니메이션·대형 이미지 실패 동작을 로컬에서 증명하기 전까지 전체 판정은 **보안 승인 보류**다.

## Independent media-hardening security re-review — 2026-09-26

Scope: source-only review of the media verification proof flow, authenticated quota and intent RPCs, bounded JSON readers, forced-password-change route/UI/migrations, and Storage lifecycle policies. I did not read the separate code-review report. No application or migration code was changed. Build, database, hosted-service, and browser behavior remain unverified because the local environment is currently unavailable.

### Static controls confirmed

- `POST /api/media/verify` checks same-origin, parses JSON with a bounded streaming reader, requires an authenticated Supabase user/session, verifies local HMAC configuration before quota checks or Storage download, and applies an owner-scoped quota before expensive work. The download uses the caller's JWT, not an elevated key.
- `consume_media_verification_attempt(uuid)` is a `SECURITY DEFINER` function with a fixed `pg_catalog` search path. The backing quota table grants no client access; the function is executable only by `authenticated`, checks the caller owns a still-pending authorized upload, and uses a per-user upsert with a 5-attempt fixed 60-second window. The conflict/update operation serializes concurrent increments on the user's quota row.
- `get_media_verification_intent(uuid)` returns only the caller's pending upload fields, is similarly fixed-search-path and authenticated-only, and avoids widening `media_assets` column grants. The Storage policies have no UPDATE policy, so an uploader cannot replace bytes at the pending path after upload through an upsert.
- The route compares actual downloaded byte length to the intent and Storage object size, detects the image format from content, caps decoded pixels, rejects formats outside JPEG/PNG/WebP, rejects multi-page inputs when Sharp reports multiple pages, and invokes `stats()` to force decoding. It signs the measured stored-byte count and SHA-256 into a short-lived proof.
- `activate_media_upload` requires an authenticated caller, verifies the HMAC against the matching Vault key, checks the timestamp window and caller-owned pending row/path/content type/declared byte counts, compares Storage metadata size, consumes a unique nonce and proof hash, and activates the row in one transaction. Its old one-argument signature is dropped; execution is granted only to `authenticated`.
- Forced-password changes reauthenticate the same account with its current password before updating it. The old automatic Auth trigger is removed; only a service-role RPC can clear the private marker after the route verifies the password change. The migration installs database write triggers and a restrictive Storage policy while the marker remains set. The bounded JSON reader caps bytes before retaining request chunks and rejects malformed UTF-8/JSON.

### Findings and remaining limits

1. **Medium — original-file size is a client claim, not server-observed evidence.** The upload-intent RPC accepts `p_original_bytes` from the authenticated browser and stores it; the proof binds that same value but does not independently measure the pre-optimization source file. An altered client can claim a smaller original size while uploading a final object below the server's 100,000,000-byte cap. The stored object itself is measured and capped server-side, but the separate requirement to reject any original input at or above 100 MB is enforced only by the normal browser client. Enforcing that exact requirement against modified clients requires the server to receive/measure the original bytes, or the product requirement must be defined as a limit on stored upload bytes.

2. **Medium — expensive work is only limited per account.** Each accepted verification downloads up to 99,999,999 bytes into a Blob/ArrayBuffer-backed buffer and decodes up to 40 million pixels, while the SQL quota permits five attempts per authenticated account per fixed window and does not impose a global or per-instance concurrency ceiling. Multiple accounts or concurrent requests can still consume substantial memory, CPU, and Storage egress. Deployed function concurrency/resource limits and abuse controls were not available for verification; consider streaming/staging the object and adding deployment-level concurrency or broader rate limits before public exposure.

3. **Low/Medium — Vault key mismatch is discovered after image processing.** `assertMediaVerificationConfigured()` fails fast for a missing/malformed local signing key before downloading the file, which is good. It cannot establish that Supabase Vault contains the matching key id/value. A missing or mismatched Vault entry is only rejected in `activate_media_upload`, after download and image decoding; repeated attempts then spend the expensive work before returning an error. Provisioning steps document the shared key, but this configuration path needs an operational check or a safe health check before production use.

4. **Open format-coverage question — animated PNG/APNG.** Multi-page files are rejected when Sharp reports `metadata.pages > 1`, and animated WebP is included in the route's all-frame read. The locally installed Sharp type documentation explicitly lists animated GIF and WebP (and multi-page formats) for `pages`, but does not list APNG. Since PNG is accepted, static inspection does not prove that every APNG is recognized/rejected or that all frames are decoded. Verify a crafted APNG on the deployed Sharp/libvips build or explicitly reject animation markers if static-only PNG is a requirement.

### Runtime verification still required

No migration was applied and no local disposable Supabase instance was available. Therefore Vault view privileges/key agreement, function ownership and grants on the actual database, RLS/Storage behavior, Storage metadata shape/consistency, quota atomicity under concurrent RPC calls, replay rejection, animated-image decoding, Supabase Auth cookie/session behavior, and deployed memory/time/concurrency limits remain unverified. Treat the present review as static-only, not a security sign-off for production.

## Final media-security re-review — 2026-09-26

**판정: 정적 보안 승인 보류.** 이 절은 바로 앞선 미디어 강화 재검토의 최종 코드 상태를 갱신한다. HMAC/Vault 사전 확인, 전역 슬롯과 사용자 quota, APNG 방어, 요청 본문 상한은 이제 소스에 추가되어 있다. 앞선 검토의 해당 미구현·불확실 코드 지적은 해소됐지만, 아래의 직접 RPC 슬롯 점유 위험과 실행 증거 부족은 남아 있다. 이번에는 지정 소스와 migration만 독립 검토했으며 애플리케이션·migration 코드는 변경하지 않았다.

### 정적으로 확인한 통제

- 검증 API는 Origin, 로그인 상태, bounded JSON을 확인하고, 검증용 로컬 HMAC key 설정을 다운로드 전에 검사한다. `get_media_verification_intent`와 슬롯 RPC는 호출자의 UUID, 본인 업로드, `PENDING` 상태, 현재 대상 권한을 각각 확인한다. Storage 객체는 상승된 서비스 키가 아닌 사용자 세션으로 읽는다 (`app/api/media/verify/route.ts:55–120`, `supabase/migrations/20260926171000_media_verification_intent_rpc.sql:3–28`, `supabase/migrations/20260926173000_media_verification_budget_and_key_preflight.sql:108–117`).
- 서버가 난수 challenge를 생성하고 media ID·key ID에 결속해 서명한다. Vault RPC는 일치하는 secret으로 같은 HMAC을 계산해 boolean만 반환한다. 이 검사는 객체 다운로드·디코딩 전에 있어 Vault 누락/불일치면 비용이 큰 이미지 작업으로 가지 않는다 (`lib/media/verify-proof.ts:22–56`, `supabase/migrations/20260926173000_media_verification_budget_and_key_preflight.sql:22–82`, `route.ts:136–151`).
- DB 슬롯 claim은 advisory transaction lock 아래 사용자당 60초 5회 quota와 DB 전역 2개 lease를 원자적으로 처리한다. 비밀 임대 토큰 원문은 응답 시에만 주고 digest만 저장하며, capacity/quota 거절은 제한된 `Retry-After`로 반환한다. 라우트는 claim 뒤 모든 반환·오류 경로에서 `finally`로 release를 시도하고, 작업 중 프로세스 종료 시 90초 만료가 복구한다 (`supabase/migrations/20260926173000_media_verification_budget_and_key_preflight.sql:84–195`, `route.ts:118–134, 201–213`).
- 서버는 실제 저장 바이트를 읽어 의도 및 Storage 크기와 대조하고, 실제 포맷, JPEG/PNG/WebP allowlist, 99,999,999바이트, 40MP를 적용한다. `animated: true`와 Sharp `pages > 1` 검사, 최대 4,096개 pre-IDAT chunk만 읽는 PNG parser의 `acTL` 거부로 APNG/애니메이션 입력도 차단하도록 되어 있다. 그 다음 디코딩을 강제하고 SHA-256을 포함한 60초 HMAC proof를 만든다 (`app/api/media/verify/route.ts:20–45, 153–193`).
- 활성화 SQL은 같은 서명 key로 원문 proof를 확인하고, timestamp, UUID, 업로더, `PENDING`, path/type/크기, 업로드 권한, 저장 객체 크기를 재검사한다. nonce 및 proof digest 유일 제약을 한 트랜잭션에서 소비한 뒤에만 `ACTIVE`로 전환하고 이전 무증명 RPC signature를 제거한다 (`supabase/migrations/20260926170000_trusted_media_proofs_and_password_gate.sql:13–130`).
- API 본문은 Content-Length 선검사와 스트리밍 byte 상한을 함께 적용한다. 계정 변경 라우트도 4KB, 미디어 검증 라우트는 2KB까지 읽는다. 기존 비밀번호를 다시 인증하고 새 비밀번호 재사용을 거부한 다음 Auth 변경 후 server-only 권한으로만 legacy marker를 해제한다. 이전 Auth hash trigger는 제거되며 공개 데이터 쓰기 trigger와 Storage restrictive policy가 gate 상태에서 동작하도록 설계됐다 (`lib/server/read-bounded-json.server.ts:9–56`, `app/api/account/legacy-password-change/route.ts:12–60`, `supabase/migrations/20260926150000_legacy_password_change_gate.sql`, `supabase/migrations/20260926170000_trusted_media_proofs_and_password_gate.sql:132–155`).

### 남은 보안 발견

1. **보통 — 공개된 슬롯 RPC를 직접 호출해 전역 이미지 검증을 막을 수 있다.** `claim_media_verification_slot(uuid)`는 `authenticated` 역할에 EXECUTE가 허용되어 있고 (`supabase/migrations/20260926173000_media_verification_budget_and_key_preflight.sql:164–167`), 응답에 임대 토큰을 돌려준다. 호출자는 본인 메뉴 또는 리뷰에 대한 유효한 `PENDING` intent만 필요하며, 이 함수는 Storage 객체가 실제 존재하는지 요구하지 않는다. 따라서 임의의 로그인 사용자가 RPC를 직접 호출해 2개 전역 슬롯을 얻고 토큰을 버릴 수 있다. 90초 만료와 분당 5회 quota는 각 점유 시간을 제한하지만, 매 만료 주기마다 슬롯 두 개를 다시 예약할 수 있어 사진 검증의 지속적 거부 서비스로 이어질 수 있다. 웹 라우트의 `finally`는 정상 라우트 호출에서만 보장되고 직접 RPC 호출은 release할 의무가 없다. 공개 사용자 RPC에서 슬롯을 직접 발급하지 말고 서버의 신뢰 가능한 호출만 허용하는 경계를 마련해야 한다. 이 직접 PostgREST 시나리오는 런타임 실행 검증은 하지 않았다.
2. **보통 — 최적화 전 파일 크기는 서버가 관측하지 못한다.** `original_bytes`는 브라우저가 intent 생성 시 보낸 값이며 proof가 그 값을 결속할 뿐, 서버는 Storage에 올라간 최종 객체 크기만 독립 측정한다. 변조 클라이언트는 원본이 100MB 이상이어도 더 작은 원본 크기를 주장하고 100MB 미만의 객체를 올릴 수 있다. 이 한계는 기존 보안 문서에 정확히 기록되어 있다 (`docs/security/media-validation-key.md`). 별도 승인된 제품 정의가 없다면 현재 증거로 보장 가능한 상한은 저장 객체 크기다.

### 런타임 증거 및 출시 판정

이 검토에서는 migration 적용, Postgres/PostgREST 직접 호출, Storage/Auth, 빌드, 테스트, 브라우저 또는 hosted service를 실행·조회하지 않았다. 따라서 함수 소유자·실제 role grant, Vault 권한과 Node/SQL HMAC parity, 전역 lease/quota의 동시성, direct RPC abuse, replay 방지, 실제 객체 metadata, Storage RLS, password/session 동작, APNG fixture, 대형 사진의 memory/time/concurrency 동작은 아직 입증되지 않았다. **정적 코드의 개선은 확인했으나 사진 업로드 보안 및 운영에 대한 승인은 보류한다.** disposable local Supabase에서 직접 권한 우회와 슬롯 고갈을 우선 재현하고, challenge/activation/replay, APNG, 대형 객체, forced-password 경계까지 확인한 뒤 다시 판정해야 한다.

## 2026-09-26 최종 재검토 — 미디어 슬롯 RPC 경계

**범위 판정: 직접 `authenticated` 슬롯 RPC 점유 수정은 정적 검토에서 승인한다. 전체 보안 승인이나 런타임 성공 판정은 아니다.** 기존 `claim_media_verification_slot(uuid)` 및 `release_media_verification_slot(uuid, text)`는 권한을 회수한 뒤 제거되고, 대체 `_server` 함수는 `service_role`만 실행할 수 있으며 함수 안에서도 service role을 확인한다 (`supabase/migrations/20260926180000_media_verification_slot_server_boundary.sql:3–8, 13–28, 120–123, 127–157`). 검증 라우트는 확인된 사용자 ID를 server-only helper로 전달하고, 종료 경로에서 슬롯 해제를 시도한다 (`app/api/media/verify/route.ts:117–133, 200–209`; `lib/supabase/admin.server.ts:38–49`). 별도의 독립 코드 검토에서도 코드 발견 사항은 없었다.

### 남은 보통 수준의 가용성 우려 및 별도 제한

- 슬롯 claim은 전역 advisory lock 안에서 만료 quota 행을 정리한다. 오래된 행 삭제가 claim마다 직렬화되므로 quota 테이블이 커지면 claim 지연이 커질 수 있다 (`supabase/migrations/20260926180000_media_verification_slot_server_boundary.sql:34–37, 75–78`).
- 라우트는 Storage 객체를 내려받기 전에 슬롯을 claim한다. 업로드 객체가 아직 없는 유효한 `PENDING` intent도 요청 경로에서 잠시 슬롯을 차지할 수 있고, 다운로드 실패 후 `finally`가 해제를 시도한다. 이 해제 동작 자체도 아직 런타임 검증 전이다 (`app/api/media/verify/route.ts:117–133, 152–159, 200–208`).
- 기존 제한으로, `original_bytes`는 업로드 intent에 들어온 클라이언트 주장값이다. 서버가 검증하는 저장 바이트와 이 주장을 proof에 결속해도 업로드 전 원본 바이트 수를 독립 측정하는 것은 아니다 (`app/api/media/verify/route.ts:97–113, 185–192`; `docs/security/media-validation-key.md`).

### 검증 범위와 최종 판정

새 migration은 적용하지 않았고 실제 `authenticated`/`service_role` 권한 동작도 확인하지 못했다. Docker Desktop Linux 엔진 연결 pipe `//./pipe/dockerDesktopLinuxEngine`가 없고 `docker-desktop` WSL 배포판은 `Stopped` 상태라 로컬 DB 검증을 수행할 수 없었다. Hosted Supabase/Vercel은 조회하거나 변경하지 않았다. 따라서 이 판정은 지정된 슬롯 RPC 수정의 정적 승인으로 한정되며, migration 적용, 역할 경계의 실제 동작, 전체 사진 보안 또는 출시 준비를 승인하지 않는다.