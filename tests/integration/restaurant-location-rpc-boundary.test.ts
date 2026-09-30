import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("disposable Supabase test exercises direct RPC denials and a valid owner write", () => {
  const databaseTest = read("supabase/tests/restaurant_location_consent_security.sql");
  assert.match(databaseTest, /has_column_privilege\('authenticated',[\s\S]*?'address', 'INSERT'\)/i);
  assert.match(databaseTest, /has_column_privilege\('authenticated',[\s\S]*?'latitude', 'UPDATE'\)/i);
  assert.match(databaseTest, /authenticated direct address insert is rejected/i);
  assert.match(databaseTest, /authenticated direct longitude update is rejected/i);
  assert.match(databaseTest, /latitude outside the valid range/i);
  assert.match(databaseTest, /longitude outside the valid range/i);
  assert.match(databaseTest, /SET LOCAL ROLE anon[\s\S]*?throws_ok\([\s\S]*?anonymous direct RPC write is rejected/i);
  assert.match(databaseTest, /SET LOCAL ROLE authenticated[\s\S]*?throws_ok\([\s\S]*?authenticated direct RPC write is rejected/i);
  assert.match(databaseTest, /assigned restaurant owner required[\s\S]*?another restaurant/i);
  assert.match(databaseTest, /lives_ok\([\s\S]*?assigned owner can save a location/i);
  assert.match(databaseTest, /ROLLBACK;/);
});

test("only a verified owner route can invoke the privileged location writer", () => {
  const route = read("app/api/restaurants/[id]/location/route.ts");
  const admin = read("lib/supabase/admin.server.ts");
  const migration = read("supabase/migrations/20260928140000_restaurant_location_consent.sql");
  const auth = route.indexOf("supabase.auth.getUser()");
  const ownerCheck = route.indexOf('rpc("owner_can_set_restaurant_location"');
  const geocode = route.indexOf("forwardGeocodeAddress(address)");
  const write = route.indexOf("setRestaurantLocationServer({");
  assert.ok(auth >= 0 && auth < ownerCheck && ownerCheck < geocode && geocode < write);
  assert.match(route, /body\.consent !== true/);
  assert.match(route, /ownerId: authData\.user\.id/);
  assert.match(admin, /^import "server-only";/);
  assert.match(admin, /SUPABASE_SECRET_KEY \?\? process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /rpc\("server_set_restaurant_location"/);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(migration, /FROM private\.restaurant_owners AS owner_row[\s\S]*?owner_row\.user_id = p_owner_id/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.server_set_restaurant_location\([\s\S]*?TO service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.server_set_restaurant_location\([\s\S]*?TO authenticated/);
});

test("GPS uses explicit browser permission and reverse-geocodes only an address label", () => {
  for (const [file, message] of [
    ["components/catalog/discovery/DiscoveryFilters.tsx", "브라우저 위치 권한을 기다리고 있어요."],
    ["frontend/src/pages/HomePage.tsx", "브라우저 위치 권한을 기다리고 있어요."],
  ]) {
    const client = read(file);
    assert.match(client, /navigator\.geolocation\.getCurrentPosition/);
    assert.ok(client.indexOf(message) < client.indexOf("getCurrentPosition"));
    assert.match(client, /reverseGeocode|\/api\/location\/reverse/);
    const disclosure = client.indexOf("좌표가 앱 서버를 거쳐 VWorld 요청 URL");
    const control = client.indexOf("현재 위치로");
    assert.ok(disclosure >= 0 && disclosure < control, "the VWorld coordinate disclosure appears before the GPS control");
    assert.match(client, /브라우저 주소·저장소·DB·앱 로그·텔레메트리에는 저장하지 않아요/);
    assert.doesNotMatch(client, /좌표는 이 브라우저에서만 사용해요/);
    assert.doesNotMatch(client, /localStorage|sessionStorage|params\.set\(['"](?:lat|latitude|lon|longitude)/i);
  }
  const legacyApi = read("frontend/src/api/catalog.ts");
  const requestClient = read("frontend/src/api/client.ts");
  assert.match(legacyApi, /method: 'POST', json: \{ latitude, longitude \}/);
  assert.match(requestClient, /if \(csrf \?\? isUnsafe\)[\s\S]*?getCsrfToken\(\)/);
});

test("legacy guests can POST reverse-geocoding with CSRF protection and no-store responses", () => {
  const security = read("backend/src/main/java/com/yumreview/auth/SecurityConfig.java");
  const controller = read("backend/src/main/java/com/yumreview/location/LocationSearchController.java");
  assert.match(security, /\.csrf\(csrf -> csrf/);
  assert.match(security, /requestMatchers\(HttpMethod\.POST,[\s\S]*?"\/api\/location\/reverse"\)\.permitAll\(\)/);
  assert.match(controller, /@PostMapping\("\/reverse"\)/);
  assert.match(controller, /ResponseEntity\.status\(status\)\.cacheControl\(CacheControl\.noStore\(\)\)/);
  assert.match(controller, /request\.getRemoteAddr\(\)/);
  assert.doesNotMatch(controller, /getHeader\("(?:X-Forwarded-For|Forwarded)"\)/i);
});
