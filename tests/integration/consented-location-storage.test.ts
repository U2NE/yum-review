import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

function databaseFunctionSource(migration: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${escapedName}\\b[\\s\\S]*?AS\\s+\\$\\$[\\s\\S]*?\\$\\$;`,
    "i",
  ));
  return match?.[0] ?? "";
}

test("restaurant location writes require a current consent and verify assigned ownership inside the database", () => {
  const migration = read("supabase/migrations/20260928140000_restaurant_location_consent.sql");
  assert.match(migration, /location_consent_version\s+text/i);
  assert.match(migration, /location_consent_at\s+timestamptz/i);
  const preflight = databaseFunctionSource(migration, "owner_can_set_restaurant_location");
  const writer = databaseFunctionSource(migration, "server_set_restaurant_location");
  assert.match(preflight, /SECURITY DEFINER\s+SET search_path = pg_catalog/i);
  assert.match(preflight, /private\.owns_restaurant\(p_restaurant_id\)/i);
  assert.match(writer, /SECURITY DEFINER\s+SET search_path = pg_catalog/i);
  assert.match(writer, /auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(writer, /owner_row\.user_id = p_owner_id/i);
  assert.match(writer, /owner_row\.restaurant_id = p_restaurant_id/i);
  assert.match(writer, /p_consent_version IS DISTINCT FROM 'restaurant-location-v1'/i);
  assert.match(writer, /p_latitude < -90 OR p_latitude > 90/i);
  assert.match(writer, /p_longitude < -180 OR p_longitude > 180/i);
  assert.match(writer, /location_consent_at = pg_catalog\.clock_timestamp\(\)/i);
  assert.match(migration, /REVOKE INSERT \(address, latitude, longitude\), UPDATE \(address, latitude, longitude\)[\s\S]*?ON TABLE public\.restaurants FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.owner_can_set_restaurant_location\(bigint\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.owner_can_set_restaurant_location\(bigint\)[\s\S]*?TO authenticated/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.server_set_restaurant_location\(bigint, uuid, text, numeric, numeric, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.server_set_restaurant_location\(bigint, uuid, text, numeric, numeric, text\)[\s\S]*?TO service_role/i);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.owner_set_restaurant_location\(bigint, text, numeric, numeric, text\)/i);
});

test("the owner route persists only server-geocoded coordinates after explicit consent", () => {
  const route = read("app/api/restaurants/[id]/location/route.ts");
  assert.match(route, /body\.consent !== true/);
  assert.match(route, /consumeLocationSearchQuota\(request\.headers\.get\("x-real-ip"\)\)/);
  assert.match(route, /limit\.status === "unavailable"/);
  assert.match(route, /limit\.status === "limited"/);
  assert.match(route, /forwardGeocodeAddress\(address\)/);
  assert.match(route, /setRestaurantLocationServer/);
  assert.match(route, /ownerId: authData\.user\.id/);
  assert.match(route, /\)\.bind\(supabase\)/);
  assert.match(route, /hasValidCoordinates\(place\.latitude, place\.longitude\)/);
  assert.doesNotMatch(route, /request\.url.*latitude|searchParams\.set\("lat"/i);
  const adminClient = read("lib/supabase/admin.server.ts");
  assert.match(adminClient, /^import "server-only";/);
  assert.match(adminClient, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.match(adminClient, /rpc\("server_set_restaurant_location"/);
  const ownerCheck = route.indexOf('rpc("owner_can_set_restaurant_location"');
  const quotaCheck = route.indexOf("consumeLocationSearchQuota(");
  const geocode = route.indexOf("forwardGeocodeAddress(address)");
  const write = route.indexOf("setRestaurantLocationServer({");
  assert.ok(ownerCheck >= 0 && ownerCheck < quotaCheck && quotaCheck < geocode && geocode < write,
    "owner preflight and shared quota must run before geocoding, with a final owner-checked write afterward");
  assert.ok(route.indexOf("setRestaurantLocationServer({") > route.indexOf("hasValidCoordinates(place.latitude, place.longitude)"),
    "only successfully geocoded coordinates reach the server-only writer");
});

test("visitor coordinates are accepted only for transient reverse geocoding and are never written", () => {
  const route = read("app/api/location/reverse/route.ts");
  const client = read("components/catalog/discovery/DiscoveryFilters.tsx");
  const catalog = read("lib/data/catalog.ts");
  const home = read("app/page.tsx");
  assert.match(route, /readBoundedJson/);
  assert.match(route, /hasValidCoordinates\(latitude, longitude\)/);
  assert.match(route, /reverseGeocodeCoordinates\(latitude, longitude\)/);
  assert.match(route, /loadRestaurantIdsWithinRadius\(supabase, \{ latitude, longitude \}, radiusMeters\)/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /\.from\("restaurants"\)|\.update\(|\.insert\(/);
  assert.match(client, /method: "POST"[\s\S]*latitude: coordinates\.latitude[\s\S]*longitude: coordinates\.longitude/);
  assert.match(client, /serverRestaurantIds\.has\(item\.restaurantId\)/);
  assert.doesNotMatch(client, /isWithinRadius|item\.restaurant\.latitude|item\.restaurant\.longitude/);
  assert.match(catalog, /\.from\("restaurants"\)[\s\S]*?\.select\("id, latitude, longitude"\)/);
  assert.match(catalog, /isWithinRadius\(origin, \{ latitude, longitude \}, radiusMeters\)/);
  assert.match(home, /restaurant: \{ \.\.\.item\.restaurant, latitude: null, longitude: null \}/);
  assert.doesNotMatch(client, /localStorage|params\.set\("lat"|params\.set\("lon"/);
});
