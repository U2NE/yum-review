# 로컬 Supabase 개발 안내

이 안내는 승인된 Next.js·Supabase 전환 작업을 **개발자 PC의 폐기 가능한 로컬 환경**에서 진행하기 위한 것입니다. 호스팅 Supabase, 기존 Spring 데이터베이스, Vercel 운영 설정에는 연결하지 않습니다.

## 준비물

- Docker Desktop 또는 Docker 호환 런타임을 설치하고 실행합니다.
- Node.js/npm과 Supabase CLI를 준비합니다. CLI는 전역 설치하거나 프로젝트에서 `npx supabase`로 실행할 수 있습니다.

Supabase CLI는 Docker 기반 로컬 Supabase 서비스(Auth, PostgreSQL, Storage 등)를 시작합니다. 자세한 설치 방법은 [Supabase CLI 안내](https://supabase.com/docs/guides/local-development/cli/getting-started)를 참고하세요.

## 최초 로컬 실행

저장소 루트(`yum-review`)에서 실행합니다. 아직 `supabase/` 설정이 없을 때만 초기화합니다.

```powershell
npx supabase init
npx supabase start
npx supabase status
```

`supabase status`가 보여주는 **로컬 전용** API URL과 publishable/anon 키를 로컬 Next.js 환경 설정에 사용합니다. 프로젝트 구성에 따라 값은 달라지므로 문서·소스에 복사하지 마세요. `.env.local`은 Git에 추가하지 않습니다. `.env*`는 `.gitignore`에서 제외됩니다. 이때 호스팅 프로젝트에 로그인하거나 `supabase link`를 실행할 필요가 없습니다.

로컬 서비스를 중지하려면 다음을 사용합니다. 로컬 데이터는 유지됩니다.

```powershell
npx supabase stop
```

## 스키마와 테스트 데이터

- **새 Supabase 스키마 변경:** `supabase/migrations/`에 시간표시가 포함된 새 SQL migration을 추가합니다. 파일은 기존 이력처럼 append-only로 유지합니다.
- **초기 개발 데이터:** `supabase/seed.sql`에는 합성 사용자와 가게·메뉴·리뷰 등 테스트 전용 데이터를 둡니다. 실사용자의 이메일, 비밀번호 해시, 리뷰, 사진 또는 운영 데이터에서 복사한 행을 넣지 않습니다.
- 로컬 스택을 처음 시작하면 설정된 migration과 seed가 적용됩니다. 변경 후에는 로컬에서만 migration 적용 결과와 RLS 권한을 검증합니다.
- 기존 `backend/src/main/resources/db/migration/`의 Flyway V1–V6은 Spring 애플리케이션의 이력입니다. 이를 Supabase에 적용하거나 Supabase migration으로 복사해 재생하지 않습니다.

QA는 합성 데이터 또는 명시적으로 마스킹된 fixture만 사용합니다. 권한 역할(비로그인, 회원, 업주, 서버 관리자), 리뷰·좋아요·찜, 사진 접근을 각각 확인하고, 실패 응답 및 행 수 같은 검증 결과만 기록합니다. 실사용자 데이터와 운영 사진을 QA 목적으로 가져오지 않습니다.

## 운영과 분리되는 절차

로컬 구현·QA가 통과해도 운영 이관 승인을 대신하지 않습니다. 기존 DB 및 hosted Supabase의 실제 행·관계·사진 수량을 읽기 전용으로 대조하고, 계정 확인/비밀번호 호환성, SMTP, Storage 한도, 백업·복구 및 RLS 검토를 별도 운영 gate로 완료해야 합니다. 그 전에는 운영 데이터/Auth/Storage를 변경하거나 가져오지 않습니다.

로컬 작업 중에는 `supabase link`, `supabase db push`, `supabase db pull`을 사용하지 않습니다. 특히 링크된 원격 대상으로 실행되는 명령은 이 로컬 절차에 포함되지 않습니다. 문서에 `db reset`을 안내하지 않습니다. 로컬 DB를 재생성하는 CLI 명령도 현재 작업에서 실행하지 마세요.

CLI의 로컬 개발·마이그레이션 동작은 [Supabase 로컬 개발 워크플로](https://supabase.com/docs/guides/local-development/cli-workflows)에 설명되어 있습니다.
