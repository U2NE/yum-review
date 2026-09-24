# Yum Review — 메뉴 리뷰 MVP 사양

**상태: 승인됨 (2026-09-25). 구현과 계획 진행 가능.**

## Goal

한국어 웹 플랫폼에서 사용자가 식당별 메뉴를 찾아보고, 각 메뉴에 대한 리뷰를 작성·수정·삭제할 수 있다. 리뷰는 계정과 연결되어 데이터베이스에 지속적으로 저장된다. 식당 전체 평점은 제공하지 않는다.

## Topology

1. **메뉴 탐색 홈** — 메뉴명 또는 식당명 검색, 추천/평점순 메뉴 목록. 메뉴 카드에는 메뉴명, 식당명, 전체 평균 별점과 리뷰 수가 보인다.
2. **식당 상세** — 식당 정보와 소속 메뉴 목록. 각 메뉴의 평균 별점과 리뷰 수를 표시하되 식당 자체 점수는 만들지 않는다.
3. **메뉴 상세** — 메뉴의 전체 평균 별점, 맛·가성비·양 평균, 리뷰 목록과 리뷰 작성 진입점.
4. **계정** — 이메일 가입·로그인·로그아웃 및 내 리뷰 목록.
5. **리뷰 작성/수정** — 로그인 사용자가 메뉴 하나에 전체 별점, 맛·가성비·양 별점, 코멘트를 남긴다. 본인의 리뷰만 수정·삭제할 수 있다.
6. **데이터 계층** — Spring Boot REST API가 PostgreSQL의 사용자, 식당, 메뉴, 리뷰를 관리한다. 카탈로그와 리뷰는 공개 조회가 가능하고, 쓰기는 로그인과 리뷰 소유권 정책으로 제한한다.

## Constraints

- 첫 화면과 주요 사용 흐름은 한국어이며 모바일·데스크톱에 대응한다.
- 리뷰 점수 범위는 각 항목 1–5점이다.
- 사용자 한 명은 메뉴마다 리뷰를 하나만 가진다. 다시 평가할 때 새 리뷰를 중복 생성하지 않고 기존 리뷰를 수정한다.
- 별점과 리뷰 수는 저장된 메뉴 리뷰에서 계산한다.
- 비밀 값과 인증 정보는 저장소에 넣지 않는다. 환경 변수 예시와 로컬 실행 안내를 제공한다.
- 리뷰 이메일 등 인증 개인 정보는 공개하지 않는다.
- 비밀번호는 원문 저장 없이 Spring Security `PasswordEncoder`로 보호한다. 웹 요청은 서버 세션 쿠키와 CSRF 방어를 사용한다.
- 로컬 PostgreSQL은 Docker Compose로 실행한다. 운영 DB와 호스팅 설정은 이 단계에 포함하지 않는다.

## Non-goals for this MVP

- 식당 자체 별점·리뷰
- 사용자 사진 업로드, 지도·위치 기반 탐색, 주문·예약
- 소셜 로그인
- 사용자의 식당·메뉴 등록과 운영자 승인 도구
- 자동 크롤링, 외부 식당 데이터 연동, 개인화 추천
- 배포와 운영 계정 생성

초기 개발 카탈로그는 예시 데이터로 제공한다. 운영용 실제 식당·메뉴 자료는 별도로 정한다.

## Acceptance Criteria

1. 방문자는 로그인 없이 홈, 검색 결과, 식당 상세, 메뉴 상세, 공개 리뷰를 볼 수 있다.
2. 검색어가 메뉴명이나 식당명과 일치하면 관련 메뉴를 식당 맥락과 함께 찾을 수 있다.
3. 가입과 로그인이 동작하고, 로그아웃 후 인증 전용 기능은 사용할 수 없다.
4. 로그인 사용자는 메뉴 하나에 전체·맛·가성비·양 점수(각 1–5)와 코멘트를 저장할 수 있다.
5. 리뷰 저장 후 메뉴 상세의 리뷰 목록, 평균 점수와 리뷰 수가 갱신되며 새로고침 후에도 데이터가 남는다.
6. 사용자는 자기 리뷰만 수정하거나 삭제할 수 있고, 중복 리뷰는 데이터 계층에서도 차단된다.
7. 식당 상세에는 메뉴별 평점만 보이고 식당 자체 평점은 노출되지 않는다.
8. 검색 결과 없음, 리뷰 없음, 로딩, 권한 거부와 저장 오류에 이해하기 쉬운 상태를 제공한다.
9. 주요 화면이 좁은 모바일 폭과 데스크톱에서 사용할 수 있다.
10. 공개 데이터와 사용자 리뷰 쓰기에 데이터베이스 권한 정책을 적용하고, 다른 사용자의 이메일이나 리뷰를 변경할 수 없다.

## Resolved assumptions and proposed decisions

- 한국어 우선의 반응형 웹으로 시작한다.
- 사용자가 Spring Boot를 선택했다. DB 제안은 PostgreSQL이다.
- 화면 제안: React + TypeScript + Vite. Spring Boot REST API와 분리하며 개발 시 `/api` 요청은 Vite 프록시로 같은 출처처럼 전달한다.
- 서버 제안: Spring Boot 4.1.x, Java 25, Spring Security, Spring Data JPA, Flyway, Maven Wrapper.
- 인증 제안: Spring Security 기반 이메일·비밀번호 가입/로그인, `PasswordEncoder`, 서버 세션 쿠키, CSRF 방어. JWT는 MVP에 도입하지 않는다.
- 코멘트는 별점과 함께 입력하는 텍스트 필드이며 선택 입력, 최대 1,000자다.
- 초기 카탈로그는 개발·시연용 예시 데이터로 한정한다.
- 리뷰는 사용자·메뉴 조합의 데이터베이스 고유 제약으로 중복을 막는다.
- 로컬 개발은 Docker Compose로 PostgreSQL을 제공한다. 실제 공개 배포는 별도 단계다.

## Technical context

- 저장소는 프레임워크 설정과 `.planning/` 문서만 있는 신규 프로젝트이며 기존 앱 코드나 선택된 프런트엔드·백엔드가 없다.
- 사용 가능한 Node.js는 v24.14.1, Java는 25.0.2, Docker CLI는 29.8.0이다. Maven은 PATH에 없어 Maven Wrapper를 사용한다.
- Spring Boot 공식 시스템 요구사항에서 현재 안정 버전 4.1.1은 Java 17–26을 지원한다고 확인했다.
- React 공식 문서는 기존 백엔드와 결합하는 제약이 있는 앱에서 Vite 같은 도구로 React 앱을 구성할 수 있다고 안내한다.
- Spring Security는 `PasswordEncoder`와 서버 세션 인증을 제공한다. PostgreSQL은 메뉴 리뷰의 유일성, 점수 범위, 식당·메뉴·사용자 참조 관계를 데이터베이스 제약으로 보장한다.

## Relevant code

- 현재 앱 소스, 데이터베이스 스키마, UI 라우트는 없다.
- 설치된 프레임워크: `.hybrid/`, `.agents/skills/`, `.codex/`, `AGENTS.md`.

## Edge cases

- 메뉴·식당 검색 결과 없음, 데이터 없는 카탈로그, 리뷰가 아직 없는 메뉴
- 로그인하지 않은 사용자의 리뷰 작성 시도
- 중복 리뷰 경합, 잘못된 별점 또는 1,000자를 넘는 코멘트
- 다른 사용자의 리뷰 수정·삭제 시도
- DB 연결 설정 누락, 네트워크·저장 오류, 세션 만료
- 삭제 직후 집계가 최신 리뷰 수와 평균을 반영하는지 확인

## Approval questions

1. 실제 MVP 범위와 메뉴별 전체·맛·가성비·양 별점 및 코멘트 구성이 맞는가?
2. Spring Boot + PostgreSQL과 React·TypeScript·Vite 화면 구성을 승인하는가?
3. 코멘트를 선택 입력으로 두고 사용자당 메뉴별 리뷰 하나를 수정하는 방식이 맞는가?

## Research sources

- Spring Boot system requirements: https://docs.spring.io/spring-boot/system-requirements.html
- Spring Security password storage: https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/password-encoder.html
- Spring Security session management: https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html
- React app creation and existing-tooling guidance: https://react.dev/learn/creating-a-react-app
- PostgreSQL constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
