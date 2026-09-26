# UI control QA matrix

실행 대상: 로컬 Next.js 앱 `http://localhost:3001/` 및 disposable local Supabase. 외부/hosted 서비스, `localhost:3000`, 운영 데이터는 대상에서 제외한다.

상태는 각 실제 조작 후 `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, `NOT RUN`으로 갱신한다. 아래 57개 행은 역할·화면 크기별 전체 회귀 검사이며, 각 행을 끝까지 확인하지 않은 부분 검사는 `NOT RUN`으로 유지한다. 부분 브라우저 확인은 문서 아래 별도 기록한다. QA 중 만든 합성 계정·행·Storage 객체는 정확한 식별자를 기록하고 이 actor가 생성한 항목만 종료 전에 제거한다.

| # | 화면/컨트롤 | 역할 | 뷰포트 | 시작 상태 및 조작 | 기대 결과 | 실제 결과/증거 | 상태 |
|---:|---|---|---|---|---|---|---|
| 1 | 홈 브랜드 로고 링크 | Guest/member/owner/admin | 360, 390, 768, 1440 | 홈에서 클릭, 키보드 포커스 후 Enter | 홈으로 이동, 이름 접근성 라벨과 포커스 표시 | 실행 전 | NOT RUN |
| 2 | 데스크톱 주요 내비게이션 링크 | Guest/member/owner/admin | 1440 | 각 노출 링크를 차례로 클릭 | 계정/운영자/업주 관리 또는 로그인/가입의 올바른 경로로 이동 | 실행 전 | NOT RUN |
| 3 | 모바일 내비게이션/헤더 | Guest/member/owner/admin | 360, 390 | 헤더의 메뉴 컨트롤, 링크 각각 조작 | 보이는 링크만 접근 가능, 화면 넘침 없이 목적 경로 이동 | 실행 전 | NOT RUN |
| 4 | 검색어 입력·적용 | Guest/member/owner/admin | 360, 390, 768, 1440 | 메뉴 검색 입력 후 적용 | 검색어 결과 반영, 주소/상태 및 카드 갱신 | 실행 전 | PARTIAL: member pointer search only at 1265×720; browser/filter roles and viewports remain open. | PARTIAL |
| 5 | 검색 초기화/전체 필터 초기화 | Guest/member/owner/admin | 360, 1440 | 검색 및 다른 필터 설정 후 지우기/초기화 | 검색어·관련 필터가 초기 상태로 복원되고 결과 갱신 | 실행 전 | NOT RUN |
| 6 | 음식 종류 선택 | Guest/member/owner/admin | 360, 1440 | 한식/양식/중식/일식/분식/카페/술집 등 선택·조합 | 선택한 분류 결과만 표시 | 실행 전 | PARTIAL: member selected Korean filter only at 1265×720; combinations, roles and viewports remain open. | PARTIAL |
| 7 | 지역 선택·적용·초기화 | Guest/member/owner/admin | 360, 1440 | 지역을 바꾸고 적용 및 초기화 | 지역 필터가 반영·해제됨 | 실행 전 | NOT RUN |
| 8 | 장소 검색 입력·검색·결과 선택 | Guest/member/owner/admin | 360, 390, 768, 1440 | 장소 검색 후 결과를 선택 | 선택 위치가 기준점이 되고 지도 API 키 부재 시 오류 안내로 fail-closed | 실행 전 | NOT RUN |
| 9 | 현재 위치 사용 | Guest/member/owner/admin | 360, 390 | 위치 허용 및 거부 상태에서 버튼 조작 | 허용 시 좌표 설정; 거부/미지원 시 이해 가능한 안내, 임의 위치 미설정 | 실행 전 | NOT RUN |
| 10 | 반경 선택 | Guest/member/owner/admin | 360, 1440 | 각 제공 반경(포함: 수백 m, 1km)을 선택하고 적용 | 선택 반경 내 결과로 갱신, 위치 기준 없는 경우 안내 | 실행 전 | NOT RUN |
| 11 | 정렬 선택 | Guest/member/owner/admin | 360, 1440 | 전체/맛/가성비/양 점수, 리뷰 수 등 제공값 선택 | 선택 기준으로 결과 정렬, 미평가 항목의 순서 확인 | 실행 전 | NOT RUN |
| 12 | 내 리뷰 개인 필터 | Guest | 360, 1440 | 로그아웃 상태에서 선택 | 로그인으로 안내/이동, 개인 데이터 노출 없음 | 실행 전 | PARTIAL: cookie-free GET /account, /my-reviews, /wishlist, /admin and /restaurants/12/manage redirected to /login; route protection only, no guest browser UI proof. | PARTIAL |
| 13 | 내 리뷰 개인 필터 | Member/owner/admin | 360, 1440 | 검색·분류·지역·반경·정렬과 조합해 선택/해제 | 본인 리뷰 메뉴만 필터링, 다른 필터와 동시 적용 | 실행 전 | PARTIAL: authenticated member pointer search on /my-reviews only at 1265×720; wider filter and role/viewport coverage remains open. | PARTIAL |
| 14 | 찜한 메뉴 개인 필터 | Guest | 360, 1440 | 로그아웃 상태에서 선택 | 로그인으로 안내/이동, 찜 목록 노출 없음 | 실행 전 | PARTIAL: cookie-free GET /wishlist redirected to /login; route protection only, no guest browser UI proof. | PARTIAL |
| 15 | 찜한 메뉴 개인 필터 | Member/owner/admin | 360, 1440 | 검색·분류·지역·반경·정렬과 조합해 선택/해제 | 본인 찜 메뉴만 필터링, 다른 필터와 동시 적용 | 실행 전 | NOT RUN |
| 16 | 메뉴 카드 상세 링크 | Guest/member/owner/admin | 360, 390, 768, 1440 | 사진/제목/상세 링크 각각 선택 | 올바른 메뉴 상세 페이지로 이동 | 실행 전 | PARTIAL: member pointer opened /menus/12 from a result at 1265×720; other link targets, roles and viewports remain open. | PARTIAL |
| 17 | 메뉴 찜/찜 해제 | Guest | 360, 1440 | 찜 버튼 클릭 | 로그인 안내, DB 쓰기 거부 | 실행 전 | NOT RUN |
| 18 | 메뉴 찜/찜 해제 | Member/owner/admin | 360, 1440 | 찜 버튼을 누르고 다시 눌러 해제 | 상태/개수/aria-pressed 갱신, 다른 계정에 노출되지 않음 | 실행 전 | PARTIAL: member favorite/unfavorite pointer toggle at 1265×720; broader roles/viewports and refresh persistence remain open. | PARTIAL |
| 19 | 식당 상세·메뉴·업주 관리 링크 | Guest/member/owner/admin | 360, 1440 | 카드에서 식당 상세, 메뉴 목록, 관리 링크 선택 | 목적 경로가 정확하고 역할에 맞는 관리 링크만 노출 | 실행 전 | NOT RUN |
| 20 | 회원가입 입력·제출·오류 | Guest | 360, 390, 1440 | 유효하지 않은 입력과 synthetic 신규 계정으로 가입 | 검증 오류 안내; 성공 시 로그인 상태/안내와 안전한 next 경로 | 실행 전 | NOT RUN |
| 21 | 로그인 입력·제출·오류 | Guest | 360, 390, 1440 | 실패 로그인, 성공 로그인, `next` 경로 로그인 | 오류 안내; 성공 후 허용된 경로로 복귀, 외부/위험 경로 차단 | 실행 전 | NOT RUN |
| 22 | 로그아웃 | Member/owner/admin | 360, 1440 | 로그아웃 선택 후 보호 경로 접근 | 세션 종료, 보호 경로 차단, 개인 정보/찜 미표시 | 실행 전 | NOT RUN |
| 23 | 내 계정 페이지 링크·현재 정보 | Member/owner/admin | 360, 390, 1440 | 계정 화면 열기 | 이름/이메일 표시; 이메일 편집 입력은 없음 | 실행 전 | NOT RUN |
| 24 | 표시 이름 저장 및 입력 검증 | Member/owner/admin | 360, 1440 | 이름 정상/빈 값/경계값 저장 | 성공·한국어 오류, 화면과 저장값 동기화 | 실행 전 | NOT RUN |
| 25 | 비밀번호 변경 및 검증 오류 | Member/owner/admin | 360, 1440 | 현재·새 비밀번호 입력, 오입력/불일치 및 정상 저장 | 접근성 있는 오류; 성공 후 새 비밀번호로 로그인 가능 | 실행 전 | NOT RUN |
| 26 | 리뷰 작성 진입/로그인 유도 | Guest | 360, 1440 | 리뷰 작성 버튼/링크 선택 | 로그인으로 이동하고 안전한 메뉴 복귀 경로 보존 | 실행 전 | NOT RUN |
| 27 | 리뷰 별점 5개 별의 왼쪽 절반 | Member/owner/admin | 360, 390, 1440 | 전체/세부 별 각 왼쪽 클릭 | 0.5 단위 정확한 값; 10개 별 나열 아님 | 실행 전 | PARTIAL: member pointer selected/deselected 0.5 on own review edit form at 1265×720, restored 5.0 and cancelled; other star halves, dimensions, roles and viewports remain open. | PARTIAL |
| 28 | 리뷰 별점 5개 별의 오른쪽 절반 | Member/owner/admin | 360, 390, 1440 | 전체/세부 별 각 오른쪽 클릭 | 1.0 단위 정확한 값; 별 5개만 표시 | 실행 전 | NOT RUN |
| 29 | 전체/세부 동일 별 재클릭 | Member/owner/admin | 360, 1440 | 같은 값을 재클릭 | 입력값 제거; 전체 점수는 필수라 제출 차단, 선택 세부값은 NULL | 실행 전 | NOT RUN |
| 30 | 세부 평가 선택 사항 | Member/owner/admin | 360, 1440 | 맛·가성비·양 미입력으로 전체 점수만 저장 | 저장 허용; 세부 정보는 보조 표시 또는 미평가 | 실행 전 | NOT RUN |
| 31 | 댓글 입력·1,000자 제한 | Member/owner/admin | 360, 1440 | 빈 댓글, 1,000자, 초과 입력 | 댓글 없이 저장 가능; 1,000자 초과 차단/오류 | 실행 전 | NOT RUN |
| 32 | 이벤트 비참여 동의 | Member/owner/admin | 360, 1440 | 체크 안 한 제출과 체크한 제출 | 미체크는 차단; 체크 시 제출 성공 | 실행 전 | NOT RUN |
| 33 | 리뷰 사진 선택·업로드·실패/재시도·제거 | Member/owner/admin | 360, 390, 1440 | synthetic 사진 선택, 추가, 오류/재시도, 제거 | 상태·진행률·파일목록 일치; 권리 확인 체크 UI 없음; 자체 객체만 cleanup | 실행 전 | NOT RUN |
| 34 | 리뷰 작성 제출/취소 | Member/owner/admin | 360, 1440 | 유효/무효 제출 및 취소 | 저장 후 리뷰/집계 갱신; 취소 시 미저장 작성 종료 | 실행 전 | NOT RUN |
| 35 | 타인 리뷰 좋아요/취소 | Member/owner/admin | 360, 1440 | 타인 리뷰에 좋아요 후 다시 취소 | 수/상태 전환 및 새로고침 후 보존 | 실행 전 | PARTIAL: member pointer liked/unliked another review at 1265×720 and restored count; broader roles/viewports and reload persistence remain open. | PARTIAL |
| 36 | 본인 리뷰 좋아요 시도 | Member/owner/admin | 360, 1440 | 본인 리뷰 카드 확인 및 직접 API 합성 요청 | UI에 좋아요 미노출; API/RLS 거부 | 실행 전 | NOT RUN |
| 37 | 본인 리뷰 수정·저장 | Member/owner/admin | 360, 1440 | 본인 리뷰 수정 진입, 값 저장 | 입력값 표시·업데이트 후 표시 및 집계 최신화 | 실행 전 | NOT RUN |
| 38 | 리뷰 삭제 및 집계 | 작성자/서버 관리자 | 360, 1440 | 자체 synthetic 리뷰 삭제 | 삭제 직후 리뷰 수/평균 최신화 | 실행 전 | NOT RUN |
| 39 | 삭제 취소/중복 조작 | 작성자/서버 관리자 | 360, 1440 | 확인 UI가 있으면 취소, pending 중 재클릭 | 취소 시 보존; 중복 요청/상태 혼란 방지 | 실행 전 | NOT RUN |
| 40 | 타인 리뷰 수정·삭제 직접 API | 다른 member/owner | 360, 1440 | 다른 synthetic 사용자 리뷰 ID로 수정·삭제 시도 | API/RLS가 거부하고 원문 보존 | 실행 전 | NOT RUN |
| 41 | 리뷰·메뉴 이미지 오류/만료 새로고침 | Guest/member/owner/admin | 360, 390, 768, 1440 | 이미지 실패를 유발하고 재시도 동작 관찰 | 제한된 재발급, 전체 문서 이동 없음, bounded fallback; 요청 빈도 기록 | 실행 전 | NOT RUN |
| 42 | 내 리뷰 페이지 및 이동 링크 | Guest/member/owner/admin | 360, 1440 | 페이지 링크 또는 직접 URL 열기 | 인증 안내 또는 본인 데이터만 표시, 찜/홈 링크 이동 | 실행 전 | PARTIAL: cookie-free GET /my-reviews redirected to /login; route protection only. Member page/link UI was pointer-tested only at 1265×720; roles/viewports and links remain open. | PARTIAL |
| 43 | 찜 목록 및 이동 링크 | Guest/member/owner/admin | 360, 1440 | 페이지 링크 또는 직접 URL 열기 | 인증 안내 또는 본인 찜만 표시, 내 리뷰/홈 링크 이동 | 실행 전 | PARTIAL: cookie-free GET /wishlist redirected to /login; route protection only, no guest browser UI proof. | PARTIAL |
| 44 | 서버 관리자 운영자 페이지 접근 | Guest/member/owner | 360, 1440 | 직접 URL 및 UI 링크 접근 | 비서버관리자 거부, 숨겨진 내용·행 미노출 | 실행 전 | PARTIAL: cookie-free GET /admin redirected to /login; route protection only, no role-specific rendered content/browser UI proof. | PARTIAL |
| 45 | 업주 할당 검색/가게·사용자 선택 | Server admin | 360, 1440 | synthetic 계정·가게 검색 및 선택 | 옵션·현재 할당이 정확히 표시 | 실행 전 | NOT RUN |
| 46 | 업주 할당/회수 | Server admin | 360, 1440 | synthetic 사용자-가게 할당 및 회수 | 권한·목록이 갱신되고 연관 범위 정확 | 실행 전 | NOT RUN |
| 47 | 업주 할당 직접 API 권한 | Guest/member/owner | 360, 1440 | 할당/회수 API 호출 시도 | 서버/RLS가 거부 | 실행 전 | NOT RUN |
| 48 | 업주 메뉴 추가/수정/초기화 | 해당 owner/server admin | 360, 1440 | synthetic 메뉴 저장·편집·폼 초기화 | 이름/설명/가격/분류 저장 후 목록 및 카드 갱신 | 실행 전 | NOT RUN |
| 49 | 업주 메뉴 비활성화/재활성화 | 해당 owner/server admin | 360, 1440 | 메뉴 상태 변경 및 공개 화면 확인 | 비활성은 일반 탐색에서 숨김; 적절한 연결 리뷰와 권한 정책 유지 | 실행 전 | NOT RUN |
| 50 | 다른 가게 메뉴 추가·수정 시도 | 다른 owner/member/guest | 360, 1440 | 직접 관리 경로/API/다른 restaurant ID 시도 | UI/API/RLS 모두 거부, 원래 메뉴 보존 | 실행 전 | NOT RUN |
| 51 | 메뉴 사진 선택·업로드·실패/재시도/제거 | 해당 owner/server admin | 360, 390, 1440 | synthetic 사진 업로드 및 조치 | 오류 안내/재시도/파일 목록 정확, 권리 확인 동의 없음 | 실행 전 | NOT RUN |
| 52 | loading/empty/error/success/image/no-image 화면 | Guest/member/owner/admin | 360, 390, 768, 1440 | 빈 검색/실패/성공/이미지 오류 상태 관찰 | 레이아웃 깨짐·가로 넘침 없음, 오류 재시도 가능 | 실행 전 | NOT RUN |
| 53 | 키보드/포커스/ARIA 선택 컨트롤 | 모든 해당 역할 | 360, 1440 | Tab/Shift+Tab/Enter/Space 및 스크린리더 이름 검사 | 조작 가능, 포커스 보임, 상태/별점/버튼 이름 전달 | 실행 전 | NOT RUN |
| 54 | 브라우저 뒤로/앞으로 및 필터 조합 | Guest/member/owner/admin | 360, 390, 768, 1440 | 필터 변경→상세→뒤로/앞으로, 필터 조합 | 주소/폼/결과가 일관되고 조건이 의도치 않게 초기화되지 않음 | 실행 전 | NOT RUN |
| 55 | API 권한: 익명 리뷰 작성 | Guest | 360, 1440 | 유효한 synthetic payload를 익명 요청 | 거부, 리뷰 수/평점 불변 | 실행 전 | NOT RUN |
| 56 | API 권한: 다른 사용자 프로필·찜 읽기 | Member | 360, 1440 | 다른 synthetic UUID로 조회 | 거부 또는 행 미노출 | 실행 전 | NOT RUN |
| 57 | API 권한: 다른 계정 미디어 연결/Storage 분리 객체 | 다른 member/owner | 360, 1440 | 타인/다른 가게 객체 참조 또는 다운로드 | 거부, URL/객체 노출 없음 | 실행 전 | NOT RUN |

## 2026-09-26 로컬 게스트 스모크 확인

이 검사는 전체 57개 UI 회귀 검사를 대체하지 않는다. Docker Desktop의 `sailor-ingest.sock` 초기화 오류로 로컬 Supabase에 연결할 수 없어 메뉴·계정 데이터가 필요한 흐름은 진행하지 않았다. 앱은 더미 loopback 설정으로 `http://127.0.0.1:3001/`에서 열었다. Vercel·hosted Supabase·실제 비밀키를 사용하지 않았고 데이터베이스나 QA fixture도 변경하지 않았다.

| 확인한 동작 | 결과 | 관찰한 근거 |
|---|---|---|
| 홈 및 데이터 오류 화면 | PARTIAL | 홈과 필터 컨트롤이 렌더링되고, 백엔드가 없을 때 메뉴 조회 오류가 보였다. 실제 메뉴 카드·지역 값은 읽지 못했다. |
| 검색·분류·정렬·반경 적용 | PARTIAL | `qa-menu`, 한식, 가성비, 1km를 고른 뒤 키보드 Enter로 적용했다. 주소가 `/?q=qa-menu&category=KOREAN&radius=1000&sort=value`로 바뀌었다. 결과 조회는 로컬 DB 연결 오류로 확인하지 못했다. |
| 필터 초기화 | PASS | 값을 적용한 뒤 키보드 Enter로 초기화해 검색·분류·정렬·반경이 기본값으로 복원되는 것을 확인했다. |
| 장소 검색의 API 키 누락 처리 | PASS | `죽전역`을 검색하자 서버 키 설정 안내가 표시됐다. 검색 결과는 노출되지 않았고 외부 서비스 호출도 하지 않았다. |
| 현재 위치 권한 실패 처리 | PASS | 현재 위치를 요청한 뒤 시간 초과 안내가 표시됐고, 기준 위치는 단국대 죽전캠퍼스로 유지됐다. 위치 허용 성공은 테스트하지 않았다. |
| 게스트의 내 리뷰·찜 필터 | PASS | 두 필터 모두 `/login?next=%2F`로 이동했고 개인 데이터는 표시되지 않았다. |
| 게스트의 보호 페이지 | PASS | `/admin`, `/account`, `/my-reviews`, `/wishlist`, `/restaurants/1/manage` 직접 진입이 각각 해당 경로를 보존한 로그인 화면으로 이동했다. |
| 공개 메뉴 상세 | PARTIAL | `/menus/10`에서 메뉴 데이터 오류 안내를 확인했다. 로컬 DB 부재로 메뉴 상세·리뷰·사진은 검증할 수 없었다. |
| 빈 회원가입 제출 | PASS | 필수 표시 이름·이메일·비밀번호 검증이 동작했고 계정은 생성하지 않았다. |
| 빈 로그인 제출 | PARTIAL | 로그인 화면에 머물러 제출은 차단됐다. 인증 서버가 없어 잘못된 자격 증명 응답이나 정상 로그인을 확인할 수 없었다. |
| 마우스 클릭 입력 경로 | BLOCKED | 현재 Codex 브라우저 조작에서 `locator.click()`은 링크·버튼을 활성화하지 않았다. 같은 요소의 키보드 Enter 경로는 확인했다. 사이트 마우스 클릭 동작으로 판정하지 않았다. |
| 로그인 사용자·업주·서버 관리자 흐름 | BLOCKED | 로컬 Supabase 엔진을 사용할 수 없어 계정, 리뷰, 좋아요, 찜, 사진, 메뉴 관리와 권한별 화면을 검증하지 않았다. |

Next.js 프로덕션 빌드와 TypeScript 검사는 더미 loopback 설정으로 통과했으며, 사진 URL 갱신의 코드·보안 정적 검토도 완료했다. 사진 전환 시 렌더 범위 격리, 좋아요/삭제 집계, 실제 이미지 복구는 전체 UI 회귀표의 미실행 항목으로 남아 있다.

## 실행 환경과 증거

| 항목 | 값 |
|---|---|
| Browser / run date | Codex In-app Browser / 2026-09-26 |
| Next.js / local Supabase state | Next.js 16.3.6 on `127.0.0.1:3001`; local Supabase blocked before Docker engine readiness by `sailor-ingest.sock` initialization failure |
| Synthetic fixture IDs | 이번 smoke 검사에서 생성하거나 변경한 fixture 없음; 기존 QA fixture 보존 |
| Screenshot paths | 파일로 저장하지 않음; 브라우저 화면에서 확인 |
| Build / typecheck | PASS; [signed-url-refresh-verification.md](signed-url-refresh-verification.md) 참조 |
| Naver place search | 키 미설정 안내 확인; 외부 검색 호출 없이 종료 |
| Data cleanup | 새 테스트 데이터가 없어 정리 작업 없음 |

## 2026-09-26 인증 사용자 브라우저 연속 QA

이 연속 검사는 전체 57개 회귀 행의 역할·해상도 조합을 대체하지 않는다. 기존 local Supabase와 synthetic QA 데이터를 유지했고 reset은 실행하지 않았다. 앱은 `http://127.0.0.1:3001/`에서 응답했으며, 현재 review aggregate를 로컬 DB에서 read-only로 확인했다. 브라우저 자동화의 링크/버튼 `click()` 경로가 동작하지 않아 확인한 조작은 accessibility 입력 후 Enter로 활성화했다. 따라서 마우스 클릭과 전체 화면 크기 조합은 PASS로 판정하지 않는다.

| 확인한 동작 | 결과 | 관찰한 근거 |
|---|---|---|
| 홈 검색·초기화, 한식/죽전/반경/정렬 조합 | PARTIAL | 검색으로 0개 결과를 만들고 초기화해 카드가 복귀했다. 한식·죽전·500m·맛순을 적용한 주소 상태를 확인했다. 위치 없는 메뉴 1개는 반경에서 제외됐고 단일 메뉴라 정렬 우선순위는 비교하지 못했다. |
| 정렬 옵션 변경 | PARTIAL | 전체·맛·가성비·양·리뷰 수 옵션의 주소 상태 변경을 확인했다. 비교 가능한 메뉴가 하나뿐이라 결과 순서는 미검증이다. |
| 장소 검색·현재 위치 실패 처리 | PASS (실패 경로) | `죽전역` 검색 시 Naver 서버 키 필요 안내만 표시됐다. 위치 요청 시간 초과 후 단국대 기준점이 유지됐다. 키 설정, 결과 선택, 위치 허용 성공은 NOT RUN이다. |
| 회원의 내 리뷰/찜 필터 전환 | PARTIAL | 각 필터의 URL 및 `aria-pressed` on/off 전환을 확인했다. 다수 메뉴 결과에 대한 조합 필터링은 확인하지 않았다. |
| 메뉴·식당 상세 이동 | PASS | `/menus/12`와 `/restaurants/12` 경로에서 해당 상세 정보 및 홈 이동을 확인했다. |
| 회원 보호 경로 | PASS (차단 경로) | member 세션에서 `/admin`, `/restaurants/12/manage` 직접 진입은 홈으로 돌려보냈다. 서버 관리자·업주 성공 흐름은 NOT RUN이다. |
| 회원 표시 이름 수정 | PASS | synthetic member 표시 이름 저장 성공 후 원래 값 `QA 사진 확인자`로 복구했다. 이메일 편집 입력은 없었다. 비밀번호 변경은 실행하지 않았다. |
| 빈 비밀번호 변경 제출 | PARTIAL | 세 입력란을 비워 둔 채 제출해 브라우저 필수 입력 검증이 현재 비밀번호 칸으로 포커스를 돌렸다. 실제 비밀번호를 입력·변경하지 않았다. |
| 전체·세부 반별점 및 재선택 해제 | PASS (키보드 경로) | 전체 점수 0.5 선택 후 같은 값 재선택으로 미평가 해제를 확인하고 1.0을 선택했다. optional taste 4.5 입력과 value/portion 미입력을 저장했다. 포인터 좌/우 절반 적중은 NOT RUN이다. |
| 코멘트 상한 및 필수 여부 | PARTIAL | 1,100 ASCII 문자를 입력했을 때 카운터/controlled value가 1,000으로 제한됐고 빈 코멘트 제출을 확인했다. 최종 source의 2,000 UTF-16 `maxLength`와 1,000 Unicode code-point clamp를 타입 검사했다. 1,000 이모지 입력은 브라우저에서 따로 시도하지 않았다. |
| 비이벤트 동의·필수 전체 점수 검증 | PASS | 동의를 선택했으나 전체 점수 없는 제출은 `전체 별점을 선택해 주세요.`로 거부됐다. 유효 리뷰는 빈 코멘트와 미입력 세부 점수로 저장됐다. |
| 리뷰 추가·수정 및 집계 | PASS | 추가 직후 해당 메뉴가 1개/4.0점에서 2개/2.5점으로, 수정 후 2개/4.5점으로 반영됐다. read-only SQL도 `QA 사진 작성자` 4.0 및 `QA 사진 확인자` 5.0, aggregate 2/4.5를 확인했다. |
| 리뷰 삭제 및 집계 복귀 | AWAITING USER CONFIRMATION | 해당 synthetic review만 삭제하는 action-time 질문이 대기 중이다. 삭제 버튼 단계는 완료 처리하지 않았다. 기존 `QA 사진 작성자` review는 보존한다. |
| 타인 리뷰 좋아요/취소 | PASS | 기존 다른 작성자의 좋아요를 켰다가 원래 0으로 되돌렸다. 본인 review에는 좋아요 UI가 노출되지 않았다. |
| 본인 리뷰 수정 폼 취소 | PASS | 저장된 synthetic review의 수정 화면을 열어 기존 입력을 확인한 뒤 취소했다. 상세 화면으로 복귀하고 점수·집계가 유지됐다. |
| 메뉴 찜/해제 | PASS | synthetic menu 찜을 켰다가 꺼서 원래 상태로 복구했다. |
| 리뷰 이미지 표시 | PARTIAL | 기존 synthetic review image는 실패 fallback `사진을 불러올 수 없어요`를 보였다. 별도 서명 URL refresh run의 positive 복구 증거는 [signed URL verification](signed-url-refresh-verification.md)에 있으나, 현재 fixture의 positive HMAC/Vault 경로는 미검증이다. |
| 비밀번호·로그아웃·회원가입 성공, 업주/서버 관리자 CRUD, 사진 업로드, 모바일/태블릿/마우스, 뒤로/앞으로 전체 조합 | NOT RUN | 현재 세션과 브라우저 입력 한계로 전체 matrix를 수행하지 않았다. 역할·viewport별 전체 PASS로 일반화하지 않는다. |

현재 aggregate에는 새 QA review 1건이 남아 있으며, 삭제 승인 답변 전까지 유지한다. 이번 section의 부분 검증을 이유로 57개 matrix의 NOT RUN 행을 통과 처리하지 않는다.

## 2026-09-26 실제 포인터 클릭 QA

전체 57개 역할·화면 크기 조합은 완료되지 않았다. 이 기록은 현재 인증된 member 세션의 단일 브라우저 뷰포트에서 CUA 좌표 기반 포인터 클릭으로 확인한 결과다. 화면 캡처는 1265×716 CSS 픽셀로 관찰했다. 입력은 키보드 Enter/Space 대신 화면 좌표 클릭을 사용했고, 클릭 뒤 매번 새 접근성 상태 또는 URL을 확인했다. 테스트 전 데이터 상태가 보이는 찜 0, 타인 리뷰 좋아요 0을 확인했으며, 시험 후 둘 다 0으로 복구했다.

| 컨트롤 / 역할 | 클릭 전 → 클릭 후 관찰 | 결과 |
|---|---|---|
| 홈 검색, member | 검색 입력에 `곰포차`를 입력하고 화면의 `필터 적용`을 좌표 클릭했다. URL이 `/?q=...`로 바뀌고 결과가 0개 및 빈 상태 안내가 표시됐다. | PASS |
| 필터 초기화, member | 화면의 `필터 초기화`를 좌표 클릭했다. URL이 `/`로 돌아오고 검색어가 지워지며 기존 메뉴 카드 1개가 복귀했다. | PASS |
| 음식 종류 선택, member | `음식 종류` 선택 컨트롤을 좌표 클릭했다. 접근성 상태가 collapsed에서 expanded로 바뀌었다. 네이티브 선택지 목록은 캡처 화면에 표시되지 않아 개별 음식 종류 선택·적용은 확인하지 않았다. | PARTIAL |
| 메뉴 상세 링크, member | 목록 카드의 메뉴 이름을 좌표 클릭했다. URL 및 새 접근성 상태가 `/menus/12` 상세로 이동했고 메뉴 평점과 리뷰가 렌더링됐다. | PASS |
| 다른 사용자 리뷰 좋아요, member | 시작 값 0에서 리뷰의 `도움이 됐어요`를 좌표 클릭하자 선택 상태와 수가 1이 됐다. 같은 컨트롤을 다시 좌표 클릭한 뒤 선택 해제 및 수 0을 확인했다. | PASS, 원상 복구 확인 |
| 메뉴 찜, member | 홈 목록에서 시작 값 0인 `찜하기`를 좌표 클릭하자 `찜한 메뉴`, 값 1이 표시됐다. 이를 다시 좌표 클릭한 뒤 `찜하기`, 값 0을 확인했다. | PASS, 원상 복구 확인 |
| 본인 리뷰 수정 폼 진입·취소, member | 본인 리뷰의 `수정`을 좌표 클릭해 폼을 열었다. 현재 값 5.0 전체, 4.5 맛, 선택되지 않은 세부 점수와 코멘트 입력란을 확인했다. 저장 버튼은 누르지 않고 `취소`를 좌표 클릭했으며 폼이 닫혔다. | PASS |
| 반별점 좌/우 절반 및 같은 별점 해제, member | 수정 폼에서 첫 별의 왼쪽/오른쪽으로 보이는 좌표를 클릭했지만 접근성 선택값은 기존 5.0에서 바뀌지 않았다. 최신 화면을 다시 확인하고 좌표를 재지정해 재시도했지만 변화가 없었다. 별점 변경·해제 동작은 검증하지 못했다. | PARTIAL; 선택 컨트롤의 포인터 적중 실패 |
| 리뷰 작성 진입, member | 현재 계정에 이미 해당 메뉴 리뷰가 있어 신규 리뷰 작성 버튼이 노출되지 않았다. 새 리뷰 등록 및 저장은 시도하지 않았다. | NOT RUN |

위치·반경 결과, 정렬 순서 비교, 회원 필터, 새 리뷰 저장, 삭제, 업주·서버 관리자, 로그아웃, 이미지 업로드, 다른 역할·해상도는 이번 검사에서 확인하지 않았다. 리뷰 삭제·세션 종료·계정 변경·업로드는 수행하지 않았다. 메뉴 찜과 타인 리뷰 좋아요는 기존 값으로 복구되었다. 앞선 섹션의 57개 matrix 행은 이 결과를 근거로 일괄 PASS 처리하지 않는다.

### 2026-09-26 반별점 포인터 타깃 재확인

격리된 새 CUA 브라우저 탭에서 `http://localhost:3001/menus/12`를 열고 접근성 상태를 확인했다. 페이지에 `로그인`, `회원가입`, `로그인하고 리뷰 작성`이 표시되어 동일 member 세션이 없었다. 인증이 필요한 리뷰 수정 폼에는 진입하지 않았고, 접근성 타깃 클릭이나 좌표 클릭, 평점 변경은 수행하지 않았다. 따라서 이 실행의 뷰포트 및 폼의 클릭 전·후 평점/`aria-checked` 값은 관찰되지 않았다. 결과: PARTIAL, 세션 부재로 타깃 클릭 결과 판별 불가.

### 2026-09-26 반별점 포인터 회귀 재검사

인증된 `QA 사진 확인자` 세션에서 `http://127.0.0.1:3001/menus/12`를 열고 본인 리뷰의 `수정`을 포인터로 클릭했다. 수정 폼의 초기 전체 별점은 5.0이었다. CUA 포인터 좌표로 첫 별 왼쪽 절반을 클릭하자 0.5점 radio가 `Value: 1`이 되었고, 첫 별 오른쪽 절반을 클릭하자 1.0점 radio가 `Value: 1`로 바뀌었다. 동일한 오른쪽 절반을 다시 클릭하자 1.0점 radio가 `Value: 0`, 표시가 `미평가`로 바뀌었다. 이어 5.0점을 다시 선택하고 `취소`를 클릭해 폼이 닫힌 것을 확인했다. 리뷰 저장은 하지 않았다. 결과: PASS; 별 절반 적중, 재클릭 해제, 기존 값 복구 및 취소 확인.

## 2026-09-26 인증 member 세션 추가 UI QA

기존 탭이 브라우저 인벤토리에 나타나지 않아 같은 Codex in-app browser에서 지정된 정확한 origin `http://127.0.0.1:3001/menus/12`를 열었다. 저장된 QA member 세션이 유지된 것을 확인했다. 단일 1265×720 뷰포트에서 CUA 포인터 좌표로 링크·버튼을 클릭하고, 각 조작 뒤 새 접근성 상태 또는 주소를 확인했다. UI 필터만 변경했으며 리뷰·계정·메뉴 데이터는 저장하지 않았다.

| 확인한 동작 | 결과 | 관찰한 근거 |
|---|---|---|
| 메뉴 상세에서 식당 링크, member | PASS | 메뉴 상세의 식당 이름을 포인터 클릭해 `/restaurants/12`로 이동하고 식당명·지역·메뉴 1개를 확인했다. |
| 홈 검색과 적용, member | PASS | 검색어 `QA 사진 메뉴` 입력 후 `필터 적용`을 포인터 클릭했다. URL에 `q`가 반영되고 검색 결과 제목이 갱신됐다. |
| 세부 정렬·종류·지역 적용, member | PASS | `맛 평점순`, `한식`, `죽전`을 선택한 후 화면의 적용 버튼을 클릭했다. 주소가 각각 `sort=taste`, `category=KOREAN`, `region=죽전`을 포함했다. |
| 내 리뷰·찜 필터, member | PASS | 체크 상태가 각각 켜졌고 주소에 `mineReviews=1`, `wishlistedOnly=1`이 표시됐다. 두 조건 조합에서 결과 0개 및 빈 상태가 표시됐다. |
| 필터 초기화, member | PASS | 초기화 클릭 뒤 검색·종류·지역·정렬·개인 필터가 기본값으로 돌아오고 URL이 `/`로 복귀했으며 메뉴 카드가 다시 보였다. |
| 브라우저 뒤로·앞으로, member | PASS | 뒤로 가기로 조합된 필터 URL과 폼 값이 복원됐다. 앞으로 가기로 기본 `/` 주소·값과 메뉴 결과가 복원됐다. |
| 계정 화면 읽기, member | PASS (read-only) | 헤더의 `내 계정`을 열어 표시 이름과 이름 저장, 현재/새 비밀번호 입력 및 변경 버튼을 확인했다. 필드 입력·저장은 하지 않았다. |
| 타인 리뷰 좋아요, member | PASS, 원상 복구 | 기존 값 0을 확인한 뒤 토글해 값 1을 확인하고 다시 눌러 0으로 복원했다. |
| 메뉴 찜 버튼, member | PARTIAL | 시작 값 0이었다. 버튼 조작 직후 접근성 상태가 잠시 값 1·disabled로 보였으나 다음 전체 상태에서는 다시 0이었다. 완료 상태의 찜 저장을 확인하지 못했으며 데이터 변경은 남지 않았다. |
| 메뉴 상세 링크, member | PASS | 홈 메뉴 카드 제목을 포인터 클릭해 `/menus/12`로 이동하고 요약·리뷰 목록을 확인했다. |

이 검사는 일부 member UI 흐름에 한정된다. 장소 검색, 현재 위치 권한, 거리 반경 결과, 업주·서버 관리자, 다른 viewport, 사진 업로드·복구, 삭제, 직접 API/RLS 거부는 수행하지 않았다. 전체 57개 역할·viewport matrix 행은 이 부분 검증으로 PASS 처리하지 않는다.

### 2026-09-26 내 리뷰 필터 확인 시도

Hybrid QA 실행 시작 시 브라우저 인벤토리에 Codex in-app browser는 있었지만 열린 탭 목록이 비어 있었다. 지정 origin `http://127.0.0.1:3001/`의 기존 탭을 가져오려 했으나 “Tab not found in browser 1”로 실패했다. 새 탭을 열거나 로그인하지 않아 `/my-reviews` 페이지와 뷰포트는 관찰하지 못했다. 내 리뷰 검색·종류·지역·정렬·적용·초기화 필터와 찜 토글은 실행하지 않았다. 결과: NOT RUN, 기존 인증 브라우저 세션에 접근 불가.

### 2026-09-26 member 개인 필터 직접 관찰 보충

다음은 Lead가 직접 CUA 브라우저에서 관찰한 단일 인증 synthetic member 세션의 보충 증거다. 로컬 Next.js `http://127.0.0.1:3001/`와 disposable local Supabase를 사용했고, 계정은 `QA 사진 확인자`였다. 기존 57개 역할·viewport 기준 행의 상태는 변경하지 않으며, 전체 matrix는 여전히 부분 검사다.

- `/my-reviews`에서 정확한 검색 `QA 사진 메뉴`는 review 1건을 반환했고 `qa-no-match-20260926`은 empty state를 표시했다. 필터 초기화로 review가 복구됐다. `category=KOREAN`, `region=죽전`, `sort=taste`, `mineReviews=1` 조합은 radius 없이 review 1건이었다. `radius=1000`은 좌표가 없는 식당 때문에 제외했고, radius 제거 후 1건이 복구됐다.
- 조합 필터 상태에서 메뉴 12를 열고 브라우저 Back을 누르자 전체 필터 URL과 폼, review 1건이 복원됐다. Forward는 메뉴 상세로 이동했다. 처음의 짧은 인증 hydration/loading 상태는 인증된 review 상세로 해소됐다.
- `/wishlist`에는 저장된 찜이 없었다. `qa-wishlist-no-match-20260926` 검색도 empty state를 유지했고 URL은 `wishlistedOnly=1`이었다. Back은 빈 컨트롤의 `/wishlist`를, Forward는 검색 쿼리를 복원했다. 필터 초기화는 q를 지우면서 `wishlistedOnly=1` route semantics를 유지했다. 빈 데이터이므로 wishlist 정렬 또는 필터 결과 순서는 추론하지 않는다.
- 최종 브라우저는 기본 필터 상태의 `/`에 있다. 지속 DB 행 변경은 없었다. 업로드, 삭제, review 수정, 계정 수정, 비밀번호 작업은 없었다.

### 2026-09-26 member 찜·좋아요·리뷰 수정 폼 상호작용 보충

Lead가 로컬 `http://127.0.0.1:3001/`의 인증 member `QA 사진 확인자` 세션에서 직접 관찰한 추가 증거다. 단일 브라우저 뷰포트에 한정되며, 전체 57개 역할·viewport matrix와 Task 09는 PARTIAL로 유지한다. 임시 찜은 검사 후 해제했다. 리뷰·계정·사진 데이터는 생성, 저장, 수정 또는 삭제하지 않았다.

| 확인한 동작 | 결과 | 관찰한 근거 |
|---|---|---|
| 찜 필터와 `/wishlist` 검색·조합 | PASS (단일 fixture) | 메뉴 12를 임시 찜하자 홈의 `wishlistedOnly=1`과 `/wishlist`에 메뉴 1개가 나타났다. `category=KOREAN`, `region=죽전`, `sort=taste`는 1개를 반환했다. `radius=1000`은 좌표가 없는 식당이라 empty state였고 radius 제거 후 1개가 복구됐다. 정확한 검색 `QA 사진 메뉴`는 1개, `qa-no-match-20260926`은 empty state를 보였다. Back/Forward로 검색 전후 상태를 확인했고 필터 초기화는 검색어를 지우며 `/wishlist?wishlistedOnly=1` route semantics를 유지했다. 검사가 끝난 뒤 찜을 해제하고 빈 `/wishlist`를 확인했다. 단일 메뉴 fixture이므로 정렬 순위 비교는 하지 않았다. |
| 타인 리뷰 좋아요 키보드 토글 | PASS, 원상 복구 | Space 입력으로 좋아요가 0→1이 되고 `aria-pressed=true`가 됐다. 다시 Space를 입력하자 1→0 및 `aria-pressed=false`로 돌아왔다. |
| 본인 리뷰 반별점과 재선택 해제 | PASS (키보드 경로, 미저장) | 수정 폼 진입 후 다섯 별과 0.5 단위 radio 값을 확인했다. Home 키로 전체 점수 0.5를 선택했고 같은 선택에 Space를 입력해 해제했다. 이어 전체 점수 5.0으로 복구했다. 맛 점수 4.5는 유지됐다. 저장 없이 폼을 취소했다. |
| 코멘트 1,000자 상한 | PASS (입력 UI, 미저장) | 이모지 1,001개 입력 시 Unicode code point 기준 1,000자로 제한됐고 화면 카운터는 `1000/1,000`이었다(UTF-16 code unit으로는 2,000). 입력을 지우고 취소했으며 리뷰 수 2개와 메뉴 평균 4.5가 유지됐다. |
| 화면 포인터 클릭 상호작용 | 미검증 | 이번에 시험한 버튼의 물리 포인터/마우스 클릭 호출은 상태 변화를 보여주지 않았다. 키보드 Enter/Space 조작은 관찰됐다. 이는 해당 UI 자동화 호출에서의 관찰 한계이며 제품 결함으로 판정하지 않는다. |

이 보충 증거만으로 각 역할·화면 크기 조합, 비어 있지 않은 다중 메뉴 정렬, 사진 업로드, 삭제, 업주·서버 관리자 성공 흐름 또는 전체 acceptance를 PASS 처리하지 않는다.

### 2026-09-26 member 포인터 회귀 확인

Hybrid Tester가 인증된 synthetic member `QA 사진 확인자` 세션에서 로컬 `http://127.0.0.1:3001/`을 CUA 포인터 좌표로 조작했다. 관찰 뷰포트는 1265×720 한 가지다. 각 변경 뒤 접근성 상태 또는 URL을 다시 확인했다. 브라우저 뷰포트 크기 override를 사용할 수 없어 360·390·768·1440px 결과는 확인하지 않았다. 이미지 캡처는 문서용 파일로 저장할 수 없어 본 보충에는 포함하지 않았다.

| 확인한 동작 | 결과 | 관찰한 근거 |
|---|---|---|
| 홈 검색과 필터 적용, member | PASS | 포인터로 검색 필드를 눌러 `QA 사진 메뉴`를 입력하고 `필터 적용`을 클릭했다. URL에 검색어가 반영되고 메뉴 1개 결과가 나타났다. 이어 음식 종류 팝업을 포인터로 연 뒤 한식을 골라 적용하자 `category=KOREAN`이 반영됐다. |
| 메뉴 상세 진입, member | PASS | 검색 결과 카드의 메뉴명을 포인터 클릭했다. `/menus/12`로 이동해 메뉴 평점·리뷰와 식당 링크를 확인했다. |
| 내 리뷰 페이지와 검색, member | PASS | `/my-reviews`에서 기존 리뷰 1개와 개인 필터 폼을 확인했다. 포인터로 검색어를 입력하고 적용하자 `mineReviews=1` 및 검색어가 URL에 반영됐고 해당 리뷰 1개가 표시됐다. |
| 찜 및 `/wishlist`, member | PASS, 원상 복구 | 홈 메뉴 카드에서 찜을 포인터로 켜자 접근성 값이 1로 바뀌었다. `/wishlist`에 메뉴 1개가 표시됐다. 해당 카드에서 포인터로 해제하자 값이 0이 되고 빈 상태로 돌아와 임시 찜이 남지 않았다. |
| 타인 리뷰 좋아요, member | PASS, 원상 복구 | 메뉴 상세에서 다른 사용자 리뷰 좋아요를 포인터로 눌러 0→1 및 `좋아요 취소`를 확인했다. 다시 클릭해 1→0으로 복구했다. |
| 본인 리뷰 수정 취소, member | PASS | 본인 리뷰의 수정 버튼을 포인터로 눌러 전체·맛·가성비·양 점수와 선택형 코멘트 입력란을 확인했다. 저장하지 않고 취소 버튼을 눌러 수정 폼이 닫혔다. |
| 전체 별점 0.5 선택·동일값 해제, member | PASS, 미저장 | 수정 폼에서 첫 별 왼쪽 절반을 포인터 클릭하자 전체 0.5점 radio가 선택됐다. 동일 위치를 다시 클릭하자 선택이 해제되고 `미평가`로 표시됐다. 5.0점으로 원복한 뒤 폼을 취소해 리뷰 데이터는 저장하지 않았다. |
| 브라우저 뒤로·앞으로, viewport 360·390·768·1440px | NOT RUN | 이번 실행에서 CUA 브라우저 뷰포트 override를 사용할 수 없었다. 주소 표시줄 기반 뒤로·앞으로 조작도 수행하지 않았다. 이전 보충 섹션의 관찰을 유지하며 새 증거로 확대하지 않는다. |

이번 실행은 인증된 member 한 역할과 단일 1265×720 화면에 한정된다. 별점 정렬 순위 비교, 리뷰 삭제·저장, 계정 변경, 사진 업로드, 게스트·업주·서버 관리자 흐름은 검사하지 않았다. 영구 데이터 변경은 없으며 임시 찜과 좋아요는 복구했다. 기존 57개 matrix 행과 전체 Task 09 상태는 PARTIAL로 유지한다.

### 2026-09-26 홈 화면 반응형 가로 넘침 확인

Lead가 로컬 홈 화면에서 CSS 뷰포트 너비 360, 390, 768, 1440px를 각각 확인했다. 각 너비에서 `document.documentElement.scrollWidth <= innerWidth`가 참이어서 문서 전체의 가로 넘침은 관찰되지 않았다. 이 결과는 해당 네 너비에서 홈 화면 셸의 가로 넘침만 확인한다. 컨트롤 조작, 데이터 상태, 다른 경로 또는 각 화면 크기에서의 전체 역할별 흐름을 검증한 결과는 아니다. 캡처 파일은 저장하지 않았다. 기존 57개 matrix 행 상태는 그대로 두며 Task 09는 PARTIAL이다.


## 2026-09-26 residual route-only QA and browser inventory limit

A Hybrid Tester inspected the available CUA browser inventory and found only the Codex In-app Browser. A second IAB tab inherited the existing authenticated synthetic member session for `QA 사진 확인자`; no logout, data mutation, or guest-browser claim was made. No screenshots were saved. The residual run's bounded self-report is `reported` and linked to its decision.

The Lead sent cookie-free, read-only HTTP requests to local `http://127.0.0.1:3001`: `/`, `/login`, `/signup`, `/menus/12`, and `/restaurants/12` returned 200; `/account`, `/my-reviews`, `/wishlist`, `/admin`, and `/restaurants/12/manage` redirected with 307 to `/login`. Query values are intentionally omitted. The home route returned 200 with each of `q=곰포차`, `sort=overall`, and `category=KOREAN`. These probes establish only HTTP route responses and redirect behavior; they do not prove visible controls, search correctness, rendered guest behavior, browser back/forward, or responsive UI.

Pointer evidence is limited to member rows 4, 6, 13, 16, 18, 27, 35, and 42 at 1265×720. The cookie-free route evidence is limited to route protection for rows 12, 14, 42, 43, and 44. These rows remain PARTIAL; remaining roles, viewports and behaviors stay open. No guest click/back-forward or residual responsive assertions were performed. No state-changing action occurred, and no review/account/photo was created or deleted.
