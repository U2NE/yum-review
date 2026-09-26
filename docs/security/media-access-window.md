# 사진 URL의 유효기간과 캐시

**상태:** 코드 설정은 확인했지만, 로컬 Storage에서 연결 해제 후 URL·캐시가 실제로 얼마나 더 제공되는지는 검증하지 않았다.

현재 앱은 private Storage 사진에 서명 URL을 만들 때 `expiresIn` 3,600초(1시간)를 전달한다 (`lib/data/media.ts:4, 49`; `lib/data/catalog.ts:105, 241`). 사진 업로드도 `cacheControl: 3600`을 설정한다 (`lib/media/storage.ts:138, 242`).

이 두 값은 서로 다른 수명이다. [Supabase의 `createSignedUrl` 문서](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl)는 `expiresIn`을 서명 URL이 유효한 시간으로 설명한다. [Smart CDN 문서](https://supabase.com/docs/guides/storage/cdn/smart-cdn)는 서명 토큰 만료(`expiresIn`)와 객체 응답 캐시 수명(`cacheControl`)을 독립 설정으로 설명하며, 캐시된 응답은 토큰 만료 후에도 캐시 수명 동안 제공될 수 있다고 안내한다. 이 문서는 Smart CDN에서 객체를 삭제하면 관련 캐시 무효화가 전파되는 데 최대 1분이 걸릴 수 있다고도 설명한다. [Storage 다운로드·서명 URL 문서](https://supabase.com/docs/guides/storage/serving/downloads)는 기존 signed URL이 만료 전까지 유효하며 signed URL을 취소하려면 Supabase 지원에 문의해야 한다고 안내한다.

따라서 사진 연결을 해제하거나 새 서명 URL 발급을 막는 DB 정책만으로 이미 전달된 URL이나 이미 받은 바이트가 즉시 회수된다고 볼 수 없다. 반대로 코드의 `3,600` 설정만으로 이 프로젝트의 실제 로컬 잔여 접근 시간이 정확히 1시간이라고 단정할 수도 없다. Storage가 응답한 캐시 헤더, CDN 구성, 브라우저의 캐시 사용 및 연결 해제 뒤의 URL 응답을 로컬에서 측정하지 않았다. **이 프로젝트의 유효한 stale-cache 최대 시간은 미확인 상태다.**

로컬에서 확인하려면 disposable 환경에서 사진 URL을 발급하고 받아 둔 다음 사진 연결을 해제하여, 기존 URL 재요청과 캐시된 응답을 시간 경과에 따라 따로 관찰해야 한다. 결과를 얻기 전에는 즉시 폐기 또는 특정 최대 시간을 제품 보장으로 설명하지 않는다. 사용자가 다운로드해 별도로 보관한 파일은 원격에서 회수할 수 없다.