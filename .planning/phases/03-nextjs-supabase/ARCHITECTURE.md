# Architecture Decision — Root Next.js + Supabase

**상태:** 승인된 SPEC의 planning 결정. 이 문서는 설계만 기록하며 DB, 인증 설정, Storage, Vercel을 변경하지 않는다. 2026-09-25에 승인된 SPEC과 [RESEARCH.md](./RESEARCH.md)를 기준으로 한다.

## 결정 요약

- 저장소 루트에 Next.js 16 App Router를 두고 `app/`을 유일한 웹 런타임으로 삼는다. 브라우저/서버 Supabase 클라이언트는 `@supabase/ssr`로 분리하고, 16 버전의 세션 갱신용 `proxy.ts`를 사용한다. 인증 화면·개인 데이터는 요청별로 읽고 캐시하지 않는다. 서버에서 `getClaims()`로 JWT를 확인하며 `getSession()` 값을 권한 근거로 삼지 않는다. [Supabase SSR 설정](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [서버 인증 지침](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- `auth.users`가 로그인 계정의 기준, PostgreSQL이 카탈로그·리뷰·역할의 기준, 전용 **private Storage bucket**이 사진의 기준이다. 공개 앱 기능은 publishable key와 현재 사용자 JWT로 수행하며, 공개 스키마와 `storage.objects`의 RLS가 실제 권한 경계다.
- 기존 restaurant/menu/review의 BIGINT 기본 키와 메뉴·리뷰 내용을 보존한다. 새 인증 UUID는 사용자 외래키에만 도입한다. 기존 BIGINT 사용자 ID와 Supabase UUID의 연결은 클라이언트 API에 노출하지 않는 `private.legacy_user_identity`에 보관한다.
- `SUPABASE_SECRET_KEY`는 사용자 요청, Server Action, 브라우저 모듈에서 사용하지 않는다. 별도 통제된 일회성 Auth 계정 가져오기·역할 초기화·고아 Storage 정리 작업에만 서버 측으로 주입한다. 브라우저에 노출될 수 있는 접두사(`NEXT_PUBLIC_`)를 붙이지 않고 로그·소스·빌드 산출물에 출력하지 않는다. 평상시 사용자 작업은 secret key로 RLS를 우회하지 않는다. [Supabase 키/데이터 보안](https://supabase.com/docs/guides/database/secure-data)

## 기존 데이터와 신원 연결

현재 소스는 Spring Boot/Flyway + Vite React다. `app_user`는 BIGINT ID, 정규화 이메일, BCrypt 해시와 역할/강제 비밀번호 변경값을 가지며 표시 이름 또는 이메일 확인 필드는 없다. `restaurant`, `menu`, `review`는 BIGINT ID다. 메뉴 사진은 `photo_media_id`뿐 아니라 V6의 `/menu-images/...` 경로로도 연결되어 있다. 리뷰는 사용자·메뉴별 하나, 댓글 1,000자, 0.5 단위 점수와 nullable 이벤트 비참여 동의값을 쓴다. V3에서 만든 `media_asset`/`review_photo`는 업로더·출처·권리 확인값과 활성/삭제 수명주기를 기록한다. 이 사실은 저장소 소스에서 확인했으며 로컬/외부 DB의 실제 행이나 사진은 열람하지 않았다.

신규 스키마는 `public.profiles(user_id uuid references auth.users, display_name)`만 공개 프로필로 둔다. 이메일과 비밀번호는 Auth에만 둔다. 기존 계정에는 이메일 로컬 부분을 공개 이름으로 쓰지 않고 중립적인 기본 표시 이름을 준다. 사적 매핑 테이블에 `legacy_user_id → auth.users.id`를 두고 기존 리뷰, 업로더, 업주 관계를 이 UUID로 치환한다. 역할 정보는 프로필에 복사하지 않는다. 기존 식당/메뉴/리뷰 ID, 점수, 내용, 시각, 동의값, 관계는 가능한 한 그대로 옮긴다. 검증 전에는 고정값 재생성이나 조용한 행 건너뛰기를 하지 않는다.

Spring의 `BCryptPasswordEncoder`는 기본 설정으로 BCrypt를 만들며 기존 해시를 Auth 사용자 생성 API의 `password_hash` 경로로 가져올 수 있다. 다만 실제 legacy hash variant 호환성은 cutover 전용 hosted operational gate다. 로컬 구현과 disposable QA는 합성 fixture로 진행하며, 별도 hosted staging이 없다는 이유로 막지 않는다. 검증은 이미 이용 가능한 non-production hosted Supabase 또는 별도로 승인된 production preflight에서만 수행하고, 새 유료 hosted project를 만들지 않는다. 하나라도 불일치하면 해당 계정을 버리거나 임의 비밀번호를 넣지 말고 cutover를 중지해 계정별 credential migration/reset 방식을 결정한다. 해시와 비밀번호는 로그에 남기지 않는다. [Supabase BCrypt 가져오기](https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0), [비밀번호 보안](https://supabase.com/docs/guides/auth/password-security)

현재 `app_user`에는 이메일 확인 상태가 없다. 그러므로 이행에 확인 근거가 없는 기존 이메일은 **미확인 상태로 가져와** 소유자가 확인 링크를 완료한 뒤 로그인하게 한다. 인증되지 않은 계정을 삭제하거나 확인된 것으로 표시하지 않는다. 새 가입도 Supabase 확인 이메일을 보내고, 미확인 로그인은 한국어 재전송/안내 흐름으로 연결한다. 운영 SMTP, Production Site URL, 콜백 허용 목록이 준비되기 전에는 계정 이행/가입 전환을 열지 않는다. 기존 `must_change_password` 표식은 private 역할/이행 메타데이터에 보존하고, 해당 관리자는 본인 비밀번호를 바꾸기 전까지 제한된 설정 화면만 사용하게 한다. [Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [리다이렉트 설정](https://supabase.com/docs/guides/auth/redirect-urls)

## 역할과 데이터베이스 권한

서버 관리자와 업주 권한은 `private.user_roles`와 `private.restaurant_owners`에서만 판단한다. 기존 `system_role='SERVER_ADMIN'` 및 `restaurant_owner` 행은 legacy identity 매핑을 통해 가져온다. 일반 사용자가 수정 가능한 `user_metadata`나 `profiles` 값으로 권한을 판단하지 않는다. 소유자 배정/해제는 서버 관리자만 가능한 DB RPC로 하고, 최초 관리자 매핑은 통제된 일회성 이행 작업으로 설정한다. 역할 판정 helper는 필요한 경우 `SECURITY DEFINER`, 고정 `search_path`, 스키마 한정 테이블 참조를 사용하고, `PUBLIC` 실행 권한을 회수해 필요한 역할에만 부여한다. private 스키마와 역할 테이블은 Data API에 노출하지 않는다. [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Custom claims/RBAC](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac)

RLS와 최소 DB grants를 모든 노출 테이블 및 Storage 객체에 적용한다. 페이지 가드와 폼 검증은 UX 보조일 뿐이다.

| 데이터 | 읽기 | 쓰기/삭제 경계 |
| --- | --- | --- |
| profiles | 공개 표시 이름만 읽기 | `auth.uid() = user_id`인 사용자가 본인 표시 이름만 변경. 이메일/역할 필드 없음 |
| restaurants, menus | 활성 카탈로그 공개; 비활성 메뉴는 관리자/해당 업주 관리 화면에서만 | 관리자 식당·전체 카탈로그 관리. 업주는 배정된 식당의 메뉴만 관리. 메뉴 내리기는 리뷰 이력을 보존하는 비활성화 |
| reviews, review_photos | 공개 메뉴에 연결된 리뷰 읽기 | 작성자는 본인 리뷰 수정, 일반 회원은 본인 리뷰 삭제, 관리자는 관리 삭제. 업주 역할만으로 타인 리뷰 수정 불가. 소유자와 업로드자가 같은지 사진 연결에서도 확인 |
| review_likes | 집계 RPC는 개수와 요청자 자신의 상태만 반환 | `(user_id, review_id)` 유일. `user_id=auth.uid()`이며 대상이 본인 리뷰가 아닐 때만 INSERT; 사용자는 자기 행만 DELETE. UPDATE 불허 |
| wishlists | 소유자 행만 | `(user_id, menu_id)` 유일. 본인 행만 INSERT/DELETE |
| private 역할/identity | 앱 사용자 직접 읽기 불가 | 관리자 전용 RPC 또는 별도 이행 작업만 변경 |

정책은 INSERT/UPDATE의 `WITH CHECK`와 UPDATE의 `USING`을 모두 써서 소유자 재할당을 막는다. 리뷰 좋아요 본인 제한은 UI뿐 아니라 DB 정책에도 둔다. RLS 정책 조회에 사용할 인덱스와 각 유일 제약을 추가한다. 공개 좋아요 사용자 목록은 제공하지 않고 안전한 집계만 반환한다. [정책 패턴과 RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 점수·리뷰 규칙

리뷰 점수는 `NUMERIC(2,1)`로 유지한다. 전체 점수는 `NOT NULL`, 범위 0.5–5.0, `score * 2 = trunc(score * 2)` 제약을 둔다. 맛·가성비·양은 같은 범위/반점 제약을 적용하되 `NULL`을 허용한다. 각 보조 평균은 `AVG(score)`로 계산해 NULL은 제외하고, 해당 평가가 하나도 없으면 NULL과 “미평가”를 표시한다. 리뷰 수는 세부 점수 수가 아닌 전체 리뷰 행 수다. 메뉴 정렬은 표시용 반올림 전 평균값을 사용하고, 전체 평균은 정수나 반점으로 재양자화하지 않는다.

기존 이벤트 비참여 동의값은 원래의 `TRUE`/`FALSE`/`NULL` 그대로 옮긴다. 이행 시 `NULL`을 동의한 것으로 채우지 않는다. 새 리뷰 저장은 DB에서도 `non_event_review_consent IS TRUE`를 요구한다. 수정 화면은 명시적으로 다시 체크한 값만 `TRUE`로 저장한다. 별점 입력은 다섯 아이콘의 왼쪽/오른쪽 반쪽 hit area와 키보드 라디오 동작을 제공한다. 전체 점수는 필수이고 선택 후 해제할 수 없다. 세부 평가만 이미 선택한 값을 다시 눌러 NULL로 비울 수 있다.

## 사진 업로드와 보존

전용 비공개 `yum-review-media` bucket에 앱 사진만 저장한다. 오브젝트 경로는 종류와 Auth UUID 아래 무작위 ID로 두고 (`review/<uid>/<uuid>.webp`, `menu/<uid>/<uuid>.webp`), 업로드는 로그인 사용자의 JWT로 브라우저에서 Supabase Storage에 직접 한다. `storage.objects` INSERT 정책은 bucket, 사용자 경로, 허용 MIME 및 소유자를 검증하고, 경로 덮어쓰기를 금지한다. >6MB에는 재개 가능한 TUS 업로드를 사용한다. 읽기는 활성 `media_asset`와 메뉴/리뷰 연결을 확인하는 SELECT 정책에 한정하고, 사용자 화면은 짧은 만료 URL을 발급한다. Storage 비밀 키로 다운로드를 프록시하지 않는다. [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control), [업로드 방식과 한도](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [파일 크기 제한](https://supabase.com/docs/guides/storage/uploads/file-limits)

브라우저의 Web Worker에서 JPEG/PNG/WebP를 검증·WebP 변환하고, 원본이 100,000,000바이트 이상이면 거부하며 10,000,000바이트 이하를 목표로 품질/크기를 조정한다. 변환 뒤에도 10MB를 넘을 때는 가능한 최적화 결과를 사용한다. Storage bucket의 서버 측 최대 크기는 100MB 미만으로 설정해 브라우저 검사 우회도 제한한다. Production Storage 요금제에서 이 한도와 TUS 사용 가능 여부를 확인하기 전에는 업로드를 활성화하지 않는다. Vercel Function은 요청 본문에 4.5MB 한도가 있으므로 사진 바이트를 Route Handler/Server Action으로 보내지 않는다. [Vercel Function 제한](https://vercel.com/docs/functions/limitations)

기존 `media_asset`와 `review_photo` 연결, 로컬 리뷰 사진 바이트, V6의 사용자 제공 `/menu-images/...` 파일을 별도 대조표로 이관한다. 파일별 크기/해시와 DB 참조를 기록하고 모든 참조가 새 오브젝트로 해석되는지 확인한다. 메뉴의 기존 `photo_url`은 같은 메뉴 ID의 Storage 오브젝트로 옮겨 새 참조를 연결한 후에만 정적 경로 제거 대상으로 본다. 권리 체크박스를 없애므로 기존 `rights_*` 값은 바꾸지 않고, 신규 업로드에서 확인하지 않은 권리 진술을 생성하지 않도록 그 필드는 nullable/미기록으로 전환한다. 연결 해제는 먼저 DB에서 노출 상태를 폐기하고 삭제 대기 표식을 남긴 뒤 재시도 가능한 정리 작업으로 오브젝트를 제거한다. DB와 Storage 간 분산 작업이므로 재시도 전에는 원본을 지우지 않는다.

## Next.js 화면 흐름

Server Components는 공개 홈/식당/메뉴/리뷰를 현재 요청 컨텍스트의 Supabase 서버 클라이언트로 가져오고, Client Components는 반쪽 별점, 위치 허용, 좋아요, 찜, 업로드 입력을 맡는다. 로그인·가입·로그아웃·콜백·확인 링크·비밀번호 복구, 프로필/비밀번호 설정, 내 리뷰, 관리자 역할/카탈로그, 업주 메뉴 관리를 App Router 페이지와 Server Actions로 제공한다. 모든 쓰기 action도 사용자 JWT를 전달하며, DB RLS를 통과해야 완료된다.

홈 검색 상태는 URL 검색 매개변수에 두어 새로고침/뒤로 가기와 조합을 유지한다: 검색어, 음식 종류, 지역, 기준 위치/반경, 정렬, `내가 리뷰한 메뉴`, `찜한 메뉴`. 개인 필터의 메뉴 ID는 JWT가 적용된 `review`/`wishlist` 조회에서 얻어 공개 카탈로그 조건에 합친다. 비로그인 사용자는 필터를 선택할 때 로그인 경로로 안내하고 돌아올 URL을 보존한다. 인증 응답과 개인 목록은 공유 캐시를 쓰지 않는다. 메뉴 상세는 전체 평점과 보조 평균을 표시하고, 리뷰 작성/수정·삭제·사진 연결은 작성자/관리자 경계를 지킨다. 회원 설정은 표시 이름과 Auth 비밀번호만 수정하고 이메일 변경 UI/API를 제공하지 않는다. 사진 권리 체크 입력은 리뷰와 메뉴 양쪽에서 제거하고 리뷰 비이벤트 동의만 남긴다.

## 비파괴 이행과 cutover

1. 현재 Spring/Flyway DB와 Vercel 연결을 계속 원본으로 둔다. cutover를 위한 hosted 검증이 필요할 때만 이미 이용 가능한 별도 non-production Supabase를 사용한다. 별도 프로젝트가 없더라도 로컬 구현·disposable QA는 계속할 수 있으며, 이를 위해 유료 hosted staging을 만들지 않는다. 기존 Supabase 프로젝트의 실제 스키마·migration history를 대조하기 전에는 초기화, reset, `DROP`, fixture 정리 SQL을 실행하지 않는다. 새 변경은 `supabase/migrations/`에 순방향 추가한다.
2. 권한이 있는 운영자가 cutover preflight에서 동결 시점의 legacy snapshot을 안전하게 export/import한다. 계정 수, 정규화 이메일 충돌, 모든 FK, restaurant/menu/review 수, 역할 매핑, 점수·동의값 분포와 각 사진 파일/연결을 대조한다. 실제 BCrypt 로그인, SMTP/email confirmation 흐름, hosted Storage plan/limits, RLS 직접 호출과 live counts는 hosted operational gate다. 실제 해시 검증은 이미 있는 별도 non-production project 또는 승인된 production preflight에서만 수행한다. 누락·중복·호환 불가가 있으면 중단한다.
3. Cutover 직전 기존 앱 쓰기를 점검 모드로 멈추고 마지막 delta와 백업을 만든다. 검증된 데이터를 Supabase로 옮긴 후 Vercel Production에만 필요한 URL/publishable key 및 명시적으로 서버 전용인 secret을 설정한다. Preview/Development는 실제 데이터 프로젝트에 연결하지 않는다. Vercel Git 연결과 Production Branch는 변경하지 않는다.
4. 새 앱에서 사용자 쓰기를 열기 전 로그인/계정 확인, 카탈로그, 리뷰 집계, 개인 필터, 사진 참조, RLS 관리자/업주 경계의 smoke review를 완료한다. 롤백이 필요하면 먼저 신규 쓰기를 멈추고 양쪽 스냅샷을 보존한다. 구 앱으로 돌아갈 때는 Supabase cutover 이후 쓰기분을 대조/반영하기 전까지 재개하지 않는다. 구 앱에 신규 DB 스키마를 직접 연결하거나 새 데이터를 버리지 않는다.

### Cutover 전 운영 게이트

- 운영자만 legacy DB의 사용자/역할/사진 실제 행을 확인해 UUID 매핑과 `SERVER_ADMIN`/restaurant owner 목록을 확정할 것. 이 문서는 그 데이터를 조회하지 않았다.
- 확인 가능한 이메일 인증 원장이 있는지 결정할 것. 현재 스키마만으로는 없으므로 기본안은 기존 계정 미확인 처리와 확인 이메일 전송이다.
- cutover 시 필요하면 이미 이용 가능한 hosted Supabase target에서 Auth SMTP/redirect allow-list와 hosted Storage 요금제/파일 제한을 확인할 것. 새 유료 staging project는 만들지 않는다.
- 대표 Spring BCrypt hash의 Auth 로그인 호환성 및 hosted Storage plan/limits를 cutover-only operational gate로 검증할 것. 별도 hosted target이 없으면 승인된 production preflight에서 검증한다.
- 활성/대기 미디어와 정적 메뉴 사진 전체의 인벤토리·연결 대조를 끝낼 것. 권리/출처가 불명확한 기존 자산은 지우거나 확인된 것으로 표시하지 말고 이관 시 운영자가 처리할 것.

이 hosted gate는 Production 데이터/Auth/Storage 변경과 cutover에만 적용한다. disposable local Supabase에서의 구현·QA, 검토가 끝난 사용자가 승인한 코드 push, 그리고 기존 Git `main` 연결에 따른 Vercel 자동 빌드에는 유료 hosted staging이 필요하지 않다. 운영 게이트가 통과되기 전에는 Production 데이터·Auth·Storage 설정을 변경하거나 cutover하지 않는다.
