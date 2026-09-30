import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("root and Spring location adapters contain no active Naver endpoint or credentials", () => {
  const files = [
    "app/api/location/search/route.ts",
    "app/api/location/reverse/route.ts",
    "lib/data/location.ts",
    "lib/data/vworld-geocoder.server.ts",
    "backend/src/main/java/com/yumreview/location/LocationSearchController.java",
    "backend/src/main/java/com/yumreview/location/NaverLocalSearchClient.java",
    "backend/src/main/java/com/yumreview/location/VWorldGeocoderClient.java",
  ];
  const forbidden = /openapi\.naver\.com|NAVER_LOCAL_CLIENT|X-Naver-(?:Client|)/i;
  for (const file of files) assert.doesNotMatch(read(file), forbidden, `${file} still calls Naver`);
});

test("VWorld access is configured server-side and the provider result fetch is uncached", () => {
  const client = read("lib/data/vworld-geocoder.server.ts");
  const rootEnv = read("backend/src/main/resources/application.yml");
  const prodEnv = read("backend/src/main/resources/application-prod.yml");
  assert.match(client, /process\.env\.VWORLD_API_KEY/);
  assert.match(client, /cache: "no-store"/);
  assert.match(rootEnv, /VWORLD_API_KEY/);
  assert.match(prodEnv, /VWORLD_API_KEY/);
  assert.doesNotMatch(client, /NEXT_PUBLIC_VWORLD_API_KEY/);
});

test("legacy Spring geocoding shares a fail-closed hashed quota and trusts only the socket peer", () => {
  const controller = read("backend/src/main/java/com/yumreview/location/LocationSearchController.java");
  const rootEnv = read("backend/src/main/resources/application.yml");
  const prodEnv = read("backend/src/main/resources/application-prod.yml");
  assert.match(controller, /request\.getRemoteAddr\(\)/);
  assert.doesNotMatch(controller, /getHeader\("(?:X-Forwarded-For|Forwarded)"\)/i);
  assert.match(controller, /limiterEndpoint == null \|\| limiterToken\.isBlank\(\)/);
  assert.match(controller, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(controller, /yum:location-search:v1:/);
  assert.match(controller, /\.timeout\(Duration\.ofSeconds\(3\)\)/);
  assert.match(controller, /\.connectTimeout\(Duration\.ofSeconds\(2\)\)/);
  assert.match(controller, /\.cacheControl\(CacheControl\.noStore\(\)\)/);
  assert.doesNotMatch(controller, /getHeader\("(?:X-Forwarded-For|Forwarded)"\)/i);
  assert.match(rootEnv, /UPSTASH_REDIS_REST_URL/);
  assert.match(rootEnv, /UPSTASH_REDIS_REST_TOKEN/);
  assert.match(prodEnv, /UPSTASH_REDIS_REST_URL/);
  assert.match(prodEnv, /UPSTASH_REDIS_REST_TOKEN/);
});

test("legacy guests may reverse-geocode only through the CSRF-protected public POST path", () => {
  const security = read("backend/src/main/java/com/yumreview/auth/SecurityConfig.java");
  assert.match(security, /\.csrf\(csrf -> csrf/);
  assert.match(security, /requestMatchers\(HttpMethod\.POST,[\s\S]*?"\/api\/location\/reverse"\)\.permitAll\(\)/);
  assert.doesNotMatch(security, /csrf\([^)]*disable/);
});

test("Spring VWorld parsing separates provider failures from valid empty results", () => {
  const client = read("backend/src/main/java/com/yumreview/location/VWorldGeocoderClient.java");
  const controller = read("backend/src/main/java/com/yumreview/location/LocationSearchController.java");
  assert.match(client, /status == null \|\| !status\.isTextual\(\) \|\| !"OK"\.equals\(status\.asText\(\)\)/);
  assert.match(client, /result == null \|\| result\.isNull\(\)/);
  assert.match(client, /SEARCH_ERROR/);
  assert.match(client, /SEARCH_ERROR = "주소 변환 서비스에 연결하지 못했습니다\. 주소를 확인한 뒤 다시 시도해 주세요\."/);
  assert.match(controller, /result\.retryable\(\)/);
  assert.match(controller, /return retryable \? HttpStatus\.BAD_GATEWAY : HttpStatus\.BAD_REQUEST/);
});
