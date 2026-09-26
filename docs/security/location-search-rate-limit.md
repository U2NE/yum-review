# 장소 검색 요청 제한

NAVER 키가 설정된 장소 검색은 공유 Redis 창을 사용해 IP당 60초에 20회로 제한한다. 서버리스 인스턴스마다 제한이 초기화되지 않도록 Upstash Redis REST의 원자적 Lua 실행을 쓴다. Vercel이 클라이언트 IP로 덮어쓰는 `x-real-ip` 헤더의 값이 유효한 IP 형식일 때만 사용하며, IP는 키에 넣기 전에 SHA-256으로 변환한다.

NAVER 키가 없으면 외부 요청 없이 기존의 설정 안내를 반환한다. NAVER 키가 있으나 Upstash 설정, 신뢰할 수 있는 `x-real-ip`, Redis 연결 또는 응답이 없으면 외부 요청 전에 검색을 fail-closed한다.

배포 환경에는 `UPSTASH_REDIS_REST_URL`과 `UPSTASH_REDIS_REST_TOKEN`을 서버 전용 환경변수로 설정해야 한다. 현재 이 값들은 설정되지 않았으므로 NAVER 키를 추가하더라도 장소 검색은 보호 설정이 될 때까지 중단된다.

구현 근거: [Upstash Redis REST API](https://upstash.com/docs/redis/features/restapi), [Upstash REST의 원자적 Lua 실행 예](https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http), [Vercel 요청 헤더](https://vercel.com/docs/headers/request-headers).
