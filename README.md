# 한입 — 메뉴 리뷰 MVP

식당 전체 평점 대신 식당 안의 **메뉴**를 찾고 리뷰하는 웹 서비스입니다. 사용자는 전체·맛·가성비·양을 0.5점 간격으로 평가하고, 리뷰 사진과 이벤트 비참여 동의를 저장할 수 있습니다. 서버 관리자는 전체 메뉴와 리뷰를 관리하며, 업주는 연결된 가게의 메뉴만 관리합니다.

## 현재 로컬 화면

- 사이트: <http://localhost:5173/>
- API: <http://localhost:8081/>
- DB: 로컬 `yum_review`의 전용 `yum_review_mvp` 스키마
- 초기 카탈로그: 크리에이티브커피 단국대점 6개 메뉴, 볶신단국대점 26개 메뉴

이 구성은 개발용 PostgreSQL의 기존 `public` 스키마와 분리되어 있습니다. 기존 V2 가짜 메뉴에 실제 사용자 계정의 리뷰 1건이 연결되어 있어 승인된 안전 정리 마이그레이션이 공개 스키마에서 중단됩니다. 해당 리뷰의 삭제 여부를 확인받기 전까지 공개 스키마는 변경하지 않습니다. 로컬 MVP의 `yum_review_mvp`에서는 가짜 메뉴가 제거된 상태로 V3/V4/V5가 적용됩니다.

## 이 컴퓨터에서 다시 시작하기

현재 서버가 꺼져 있고 포트 8081 및 5173이 비어 있을 때 저장소 루트의 PowerShell에서 실행합니다.

```powershell
.\scripts\run-local-mvp.ps1
```

이 스크립트는 기존 개발 DB에 `yum_review_mvp` 전용 스키마를 준비하고 API와 화면을 숨김 프로세스로 시작합니다. 기존 DB 볼륨은 삭제하지 않습니다. 이미 포트가 사용 중이면 다른 프로세스를 종료하지 않고 중단합니다. 로그는 `backend/var/mvp-local/logs`에 생성됩니다. 최초 부트스트랩 때만 응답에 임시 관리자 비밀번호가 포함되며, 저장소 파일에 기록하지 않습니다. 서버 관리자 첫 로그인은 비밀번호 변경을 요구합니다.

처음 시작하는 개발 환경에는 Java 25, Node.js 24, PostgreSQL이 필요합니다. `scripts/run-local-mvp.ps1`은 이 PC의 WSL Ubuntu PostgreSQL `yum_review` 데이터베이스와 개발 계정 설정을 사용합니다.

## 기능

- 계정 가입·로그인과 서버 세션 인증
- 서버 관리자/식당별 업주 권한 및 첫 로그인 비밀번호 변경
- 메뉴 등록·수정·목록 비활성화, 서버 관리자 리뷰 삭제
- 0.5–5.0점 반점 평가, 실제 산술 평균, 전체·맛·가성비·양·리뷰 수 정렬
- 이벤트 참여 없이 작성했다는 필수 확인
- 메뉴 사진 및 리뷰 사진 업로드. 100,000,000바이트 이상은 거부하고 10MB를 넘는 이미지는 가능한 한 최적화
- 음식 종류·지역·반경 필터, 브라우저 현재 위치, NAVER 장소 검색 설정 안내
- 매장 상세 페이지의 네이버 지도 검색 링크

## 초기 카탈로그와 데이터 한계

카페와 주점 두 곳, 총 32개 메뉴를 확인 가능한 출처와 함께 넣었습니다. 볶신 메뉴 가격은 네이버 장소 메뉴 화면에 표시된 값이며 해당 화면은 최근 갱신일을 2026-01-20으로 표시하고 가격이 달라질 수 있다고 안내합니다. 최신 현장 가격을 보장하지 않습니다. 사진은 권리가 확인되지 않아 가져오지 않았습니다. 허용된 지오코더로 건물 좌표를 독립 확인하지 못해 초기 매장 좌표는 비워 두었으며, 이 두 매장은 반경 검색 결과에서 제외됩니다. 메뉴·가격·좌표의 출처와 빈 항목은 [카탈로그 출처 기록](docs/jukjeon-catalog-sources.md)에 적었습니다.

NAVER 장소 검색 키는 설정되지 않았습니다. 단국대 기본 위치와 사용자가 허용한 현재 위치 기능은 사용할 수 있고, 장소 검색은 키 설정 안내를 표시합니다. Naver Place에 올라온 사진은 재게시 권한이 확인되지 않아 다운로드하거나 저장하지 않았습니다.

## 개발 및 QA

백엔드 확인과 프런트엔드 빌드:

```powershell
Push-Location backend
try { .\mvnw.cmd -q package; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
finally { Pop-Location }
npm --prefix frontend ci
npm --prefix frontend run build
```

QA는 별도 Compose 프로젝트와 데이터베이스를 사용합니다. 실행기는 QA 프로세스와 볼륨만 정리하며 로컬 개발 DB는 건드리지 않습니다.

```powershell
.\scripts\run-qa-e2e.ps1
```

검증한 경로와 남은 데이터/권한 범위는 [QA 기록](.planning/phases/02-product-expansion/QA.md)에 정리되어 있습니다.

## 관련 파일

- 승인 사양: `.planning/phases/02-product-expansion/SPEC.md`
- Hybrid 실행 계획: `.planning/phases/02-product-expansion/PLAN.md`
- 카탈로그 출처: `docs/jukjeon-catalog-sources.md`
- 로컬 서버 시작: `scripts/run-local-mvp.ps1`
- 격리 브라우저 QA: `scripts/run-qa-e2e.ps1`
