# 한입 — 메뉴 리뷰 MVP

식당 전체를 평가하는 대신 **각 메뉴**를 리뷰하는 한국어 웹 서비스입니다. 메뉴별 전체 별점과 맛·가성비·양 세부 별점, 선택 코멘트를 저장하고 다른 사람의 공개 리뷰를 볼 수 있습니다. 식당 자체 평점은 제공하지 않습니다.

초기 식당과 메뉴는 모두 허구의 시연용 데이터입니다. 실제 식당 정보가 연동되거나 운영에 배포된 서비스는 아닙니다.

## 로컬 실행 환경

- Java 25
- Node.js 24 및 npm
- PostgreSQL (Docker Compose 또는 WSL Ubuntu에서 실행)

Windows PowerShell에서 저장소 루트(`yum-review`)를 열고 아래 순서로 실행합니다.

### 1. 로컬 환경 파일 준비

```powershell
Copy-Item .env.example .env
```

`.env`의 기본값은 로컬 개발용 PostgreSQL 계정입니다. 비밀 값이 아닌 개발 기본값이며 저장소에 `.env`를 올리지 않습니다. 백엔드 기본 연결값은 `.env.example`과 일치합니다. 값을 바꾸면 백엔드 실행 터미널에도 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` 환경 변수를 설정해 주세요.

### 2. PostgreSQL 시작

Docker Desktop을 사용하는 경우, 엔진이 준비된 뒤 저장소 루트에서:

```powershell
docker compose up -d postgres
```

Docker Desktop을 사용할 수 없는 Windows 환경에서는 WSL Ubuntu에 PostgreSQL을 설치해 실행할 수도 있습니다. 아래 계정·DB 생성 명령은 처음 한 번만 실행합니다.

```powershell
wsl -d Ubuntu -u root -- apt-get install -y postgresql
wsl -d Ubuntu -u root -- systemctl start postgresql
wsl -d Ubuntu -u postgres -- psql -c "CREATE ROLE yum_review LOGIN PASSWORD 'yum_review_local'"
wsl -d Ubuntu -u postgres -- createdb -O yum_review yum_review
```

Docker와 WSL PostgreSQL은 같은 로컬 포트(5432)를 사용하므로 둘 중 하나만 실행합니다. 첫 백엔드 실행 때 Flyway가 테이블을 만들고 허구의 식당·메뉴 예시 데이터를 넣습니다.

### 3. Spring Boot API 시작

새 PowerShell 창에서:

```powershell
Set-Location backend
.\mvnw.cmd spring-boot:run
```

API는 기본적으로 `http://localhost:8080`에서 실행됩니다. 종료하려면 `Ctrl+C`를 누릅니다.

이 컴퓨터처럼 8080 포트를 다른 프로그램이 사용 중이면, 백엔드를 시작하기 전에 포트를 바꿉니다.

```powershell
$env:SERVER_PORT = '18080'
.\mvnw.cmd spring-boot:run
```

### 4. 웹 화면 시작

또 다른 PowerShell 창에서:

```powershell
Set-Location frontend
npm ci
npm run dev
```

터미널에 표시되는 로컬 주소(기본 `http://localhost:5173`)를 브라우저에서 엽니다. Vite 개발 서버가 `/api` 요청을 백엔드 `http://localhost:8080`으로 전달합니다. 백엔드 포트를 18080으로 바꿨다면 프런트엔드를 시작하기 전에 아래 환경 변수를 설정합니다.

```powershell
$env:YUM_REVIEW_API_TARGET = 'http://localhost:18080'
npm run dev
```

계정 생성과 리뷰 저장 등 DB 기능을 사용하려면 PostgreSQL과 백엔드도 실행 중이어야 합니다.

## 화면과 기능

- `/` — 메뉴명 또는 식당명으로 검색하고 추천순·평점순 메뉴를 둘러봅니다.
- `/restaurants/{id}` — 식당 정보와 메뉴별 평점·리뷰 수를 확인합니다. 식당 평점은 없습니다.
- `/menus/{id}` — 메뉴의 전체·맛·가성비·양 평균과 공개 리뷰를 봅니다.
- `/signup`, `/login` — 이메일 계정을 만들고 로그인합니다.
- `/my-reviews` — 로그인한 사용자의 리뷰를 수정하거나 삭제합니다.

각 점수는 1–5점이고, 코멘트는 선택 입력(최대 1,000자)입니다. 사용자 한 명은 메뉴마다 리뷰를 하나만 작성하며, 다시 평가하면 기존 리뷰를 수정합니다. 리뷰 작성자 정보는 공개 화면에서 익명으로 표시되고 이메일은 공개 리뷰 응답에 포함되지 않습니다.

## 인증과 API

브라우저 인증은 서버 세션 쿠키를 사용합니다. 세션 쿠키는 HttpOnly와 SameSite=Lax 설정이며, 변경 요청에는 `/api/auth/csrf`에서 받은 토큰을 함께 보냅니다. 가입·로그인·로그아웃 뒤 프런트엔드가 CSRF 토큰을 다시 가져옵니다. HTTPS 운영용 Secure 쿠키 설정은 `application-prod.yml`에 있으며, 운영 배포는 이번 MVP 범위에 포함되지 않습니다.

주요 API:

- 공개 조회: `GET /api/menus`, `GET /api/menus/{id}`, `GET /api/menus/{id}/reviews`, `GET /api/restaurants/{id}`
- 계정: `GET /api/auth/csrf`, `GET /api/auth/me`, `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`
- 내 리뷰: `GET /api/me/reviews`, `POST /api/menus/{id}/reviews`, `PUT /api/reviews/{id}`, `DELETE /api/reviews/{id}`

## 구현 범위

이 MVP는 메뉴 검색·조회, 이메일 계정, 데이터베이스에 보관되는 메뉴 리뷰에 초점을 둡니다. 식당 리뷰·평점, 사진 업로드, 지도, 주문·예약, 소셜 로그인, 사용자의 카탈로그 등록·관리 기능, 외부 식당 데이터 연동과 배포는 포함하지 않습니다.

외부에 공개하기 전에는 로그인 시도 제한, 가입 이메일 검증, 운영 배포 보안 설정과 모니터링을 추가해야 합니다. 이메일 중복 여부를 가입 응답에서 구분하는 동작은 현재 MVP의 가입 UX를 위한 선택입니다.

이 컴퓨터에서는 Docker Desktop 엔진 시작 오류가 있어 WSL Ubuntu PostgreSQL로 실행했습니다. 브라우저에서 검색·정렬·초기화, 메뉴·식당 이동, 비로그인 리뷰 열람, 가입·로그인 검증, 리뷰 작성·수정·취소·삭제, 평점 재계산, 로그아웃까지 수동 QA했습니다. QA 도중 검색 초기화가 URL과 결과에 반영되지 않는 문제 및 비로그인 공개 리뷰 조회 문제를 수정했습니다. QA 전용 임시 리뷰와 계정은 삭제 흐름을 검증한 뒤 정리했고 기존 데이터는 보존했습니다.
