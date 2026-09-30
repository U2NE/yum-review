BEGIN;

SELECT plan(27);

SELECT has_function(
    'public',
    'server_set_restaurant_location',
    ARRAY['bigint', 'uuid', 'text', 'numeric', 'numeric', 'text'],
    'location writes use a dedicated server RPC'
);
SELECT ok(
    has_function_privilege('service_role', 'public.server_set_restaurant_location(bigint, uuid, text, numeric, numeric, text)', 'EXECUTE'),
    'the server role can execute the location writer'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.server_set_restaurant_location(bigint, uuid, text, numeric, numeric, text)', 'EXECUTE'),
    'anonymous PostgREST callers cannot execute the location writer'
);
SELECT ok(
    NOT has_function_privilege('authenticated', 'public.server_set_restaurant_location(bigint, uuid, text, numeric, numeric, text)', 'EXECUTE'),
    'authenticated PostgREST callers cannot execute the location writer'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.restaurants', 'address', 'INSERT'),
    'authenticated callers cannot insert restaurant addresses directly'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.restaurants', 'latitude', 'INSERT'),
    'authenticated callers cannot insert restaurant latitudes directly'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.restaurants', 'longitude', 'INSERT'),
    'authenticated callers cannot insert restaurant longitudes directly'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.restaurants', 'address', 'UPDATE'),
    'authenticated callers cannot update restaurant addresses directly'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.restaurants', 'latitude', 'UPDATE'),
    'authenticated callers cannot update restaurant latitudes directly'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.restaurants', 'longitude', 'UPDATE'),
    'authenticated callers cannot update restaurant longitudes directly'
);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'g2-owner@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
    ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'g2-other-owner@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now());

INSERT INTO public.restaurants (id, name, address)
VALUES (9223372036854770000, 'G2 disposable location boundary fixture', '등록 전 주소');
INSERT INTO private.restaurant_owners (user_id, restaurant_id)
VALUES ('11111111-1111-4111-8111-111111111111', 9223372036854770000);

SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '11111111-1111-4111-8111-111111111111', '서울 중구 세종대로 110', 37.5665, 126.9780, 'restaurant-location-v1')$$,
    '42501',
    'permission denied for function server_set_restaurant_location',
    'an anonymous direct RPC write is rejected'
);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '11111111-1111-4111-8111-111111111111', '서울 중구 세종대로 110', 37.5665, 126.9780, 'restaurant-location-v1')$$,
    '42501',
    'permission denied for function server_set_restaurant_location',
    'an authenticated direct RPC write is rejected'
);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
    $$INSERT INTO public.restaurants (name, address) VALUES ('anonymous direct write', '서울 중구 세종대로 110')$$,
    '42501',
    'permission denied for table restaurants',
    'an anonymous direct address insert is rejected'
);
SELECT throws_ok(
    $$UPDATE public.restaurants SET latitude = 37.5665 WHERE id = 9223372036854770000$$,
    '42501',
    'permission denied for table restaurants',
    'an anonymous direct coordinate update is rejected'
);
RESET ROLE;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    $$INSERT INTO public.restaurants (name, address) VALUES ('authenticated direct write', '서울 중구 세종대로 110')$$,
    '42501',
    'permission denied for table restaurants',
    'an authenticated direct address insert is rejected'
);
SELECT throws_ok(
    $$INSERT INTO public.restaurants (name, latitude) VALUES ('authenticated direct write', 37.5665)$$,
    '42501',
    'permission denied for table restaurants',
    'an authenticated direct latitude insert is rejected'
);
SELECT throws_ok(
    $$INSERT INTO public.restaurants (name, longitude) VALUES ('authenticated direct write', 126.9780)$$,
    '42501',
    'permission denied for table restaurants',
    'an authenticated direct longitude insert is rejected'
);
SELECT throws_ok(
    $$UPDATE public.restaurants SET address = '서울 중구 세종대로 110' WHERE id = 9223372036854770000$$,
    '42501',
    'permission denied for table restaurants',
    'an authenticated direct address update is rejected'
);
SELECT throws_ok(
    $$UPDATE public.restaurants SET latitude = 37.5665 WHERE id = 9223372036854770000$$,
    '42501',
    'permission denied for table restaurants',
    'an authenticated direct latitude update is rejected'
);
SELECT throws_ok(
    $$UPDATE public.restaurants SET longitude = 126.9780 WHERE id = 9223372036854770000$$,
    '42501',
    'permission denied for table restaurants',
    'an authenticated direct longitude update is rejected'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT throws_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '11111111-1111-4111-8111-111111111111', '서울 중구 세종대로 110', 37.5665, 126.9780, 'restaurant-location-v1')$$,
    '42501',
    'server credential required',
    'the privileged database role still requires a server-role JWT'
);

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT throws_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '11111111-1111-4111-8111-111111111111', '서울 중구 세종대로 110', 37.5665, 126.9780, 'obsolete-consent')$$,
    '22023',
    'current location consent required',
    'the server writer rejects a stale consent version'
);
SELECT throws_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '22222222-2222-4222-8222-222222222222', '서울 중구 세종대로 110', 37.5665, 126.9780, 'restaurant-location-v1')$$,
    '42501',
    'assigned restaurant owner required',
    'the server writer rejects an owner assigned to another restaurant'
);
SELECT throws_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '11111111-1111-4111-8111-111111111111', '서울 중구 세종대로 110', 90.0001, 126.9780, 'restaurant-location-v1')$$,
    '22023',
    'valid restaurant address and coordinates required',
    'the server writer rejects latitude outside the valid range'
);
SELECT throws_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '11111111-1111-4111-8111-111111111111', '서울 중구 세종대로 110', 37.5665, -180.0001, 'restaurant-location-v1')$$,
    '22023',
    'valid restaurant address and coordinates required',
    'the server writer rejects longitude outside the valid range'
);
SELECT lives_ok(
    $$SELECT public.server_set_restaurant_location(9223372036854770000, '11111111-1111-4111-8111-111111111111', '서울 중구 세종대로 110', 37.5665, 126.9780, 'restaurant-location-v1')$$,
    'the assigned owner can save a location through the server writer'
);
SELECT ok(
    EXISTS (
        SELECT 1
        FROM public.restaurants
        WHERE id = 9223372036854770000
          AND address = '서울 중구 세종대로 110'
          AND latitude = 37.5665
          AND longitude = 126.9780
          AND location_consent_version = 'restaurant-location-v1'
          AND location_consent_at IS NOT NULL
    ),
    'the approved owner address, coordinates, consent version, and timestamp are stored together'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
