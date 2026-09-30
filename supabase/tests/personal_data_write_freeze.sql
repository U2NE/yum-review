BEGIN;

SELECT plan(24);

SELECT is(public.personal_data_write_is_frozen(), false, 'freeze is inactive immediately after migration install');

-- Local-only fixtures are rolled back at the end of this pgTAP transaction.
INSERT INTO auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES (
    '00000000-0000-4000-8000-0000000000f8',
    'authenticated', 'authenticated', 'freeze-fixture@example.invalid', '',
    pg_catalog.now(), pg_catalog.now()
);
INSERT INTO public.restaurants (name) VALUES ('[pgTAP] write freeze fixture');
INSERT INTO public.menus (restaurant_id, name)
SELECT id, '[pgTAP] write freeze fixture'
FROM public.restaurants WHERE name = '[pgTAP] write freeze fixture';
INSERT INTO public.reviews (user_id, menu_id, overall_score, taste_score, value_score, portion_score)
SELECT '00000000-0000-4000-8000-0000000000f8', id, 4.0, 4.0, 4.0, 4.0
FROM public.menus WHERE name = '[pgTAP] write freeze fixture';
INSERT INTO private.user_roles (user_id, role_code)
VALUES ('00000000-0000-4000-8000-0000000000f8', 'SERVER_ADMIN');

SELECT lives_ok(
    $$SELECT private.activate_personal_data_write_freeze('yum-overhaul-20260928')$$,
    'the exact run can activate its transaction-draining freeze'
);
SELECT is(public.personal_data_write_is_frozen(), true, 'the active state is visible through the read-only status RPC');
SELECT lives_ok($$SELECT count(*) FROM public.restaurants$$, 'reads remain available while frozen');

SELECT throws_ok(
    $$UPDATE auth.users SET email_confirmed_at = pg_catalog.now() WHERE id = '00000000-0000-4000-8000-0000000000f8'$$,
    '42501',
    'Auth writes are frozen; only exact-run purge_identity DELETE is permitted',
    'Auth UPDATE is rejected while the freeze is active'
);
SELECT throws_ok(
    $$DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000000f8'$$,
    '42501',
    'Auth writes are frozen; only exact-run purge_identity DELETE is permitted',
    'project-owner and Auth-admin session identities cannot use the purge exception'
);
SELECT throws_ok(
    $$UPDATE public.profiles SET display_name = 'changed' WHERE user_id = '00000000-0000-4000-8000-0000000000f8'$$,
    '42501',
    'personal data write freeze is active',
    'profile writes are rejected'
);
SELECT throws_ok(
    $$UPDATE public.reviews SET comment = 'changed' WHERE user_id = '00000000-0000-4000-8000-0000000000f8'$$,
    '42501',
    'personal data write freeze is active',
    'review writes are rejected'
);
SELECT throws_ok(
    $$DELETE FROM private.user_roles WHERE user_id = '00000000-0000-4000-8000-0000000000f8'$$,
    '42501',
    'personal data write freeze is active',
    'role-map writes are rejected'
);
SELECT throws_ok(
    $$UPDATE public.restaurants SET name = name WHERE name = '[pgTAP] write freeze fixture'$$,
    '55000',
    'personal data write freeze is active',
    'retained restaurant rows cannot be changed while frozen'
);
SELECT throws_ok(
    $$UPDATE public.menus SET active = active WHERE name = '[pgTAP] write freeze fixture'$$,
    '55000',
    'personal data write freeze is active',
    'retained menu rows cannot be changed while frozen'
);
SELECT throws_ok(
    $$INSERT INTO public.media_assets (id) VALUES ('00000000-0000-4000-8000-0000000000f9')$$,
    '42501',
    'personal data write freeze is active',
    'direct media-asset DML is rejected before table constraints'
);
SELECT throws_ok(
    $$TRUNCATE public.restaurants$$,
    '42501',
    'personal data write freeze blocks TRUNCATE',
    'TRUNCATE cannot bypass row-level guards'
);

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000f8"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f8', true);
SELECT throws_ok(
    $$DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000000f8'$$,
    '42501',
    'Auth writes are frozen; only exact-run purge_identity DELETE is permitted',
    'caller-set JWT claims do not authorize Auth deletion'
);

SELECT ok(
    NOT has_table_privilege('purge_identity', 'public.reviews', 'DELETE')
    AND NOT has_table_privilege('purge_identity', 'auth.users', 'DELETE')
    AND NOT has_table_privilege('service_role', 'private.personal_data_purge_allowlist', 'SELECT'),
    'temporary purge identity has procedure-only access and application roles cannot read raw allowlists'
);
SELECT ok(
    (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'purge_identity')
    AND NOT (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'purge_guard_owner')
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members m
        JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
        JOIN pg_catalog.pg_roles u ON u.oid = m.member
        WHERE r.rolname IN ('purge_identity', 'purge_guard_owner')
           OR u.rolname IN ('purge_identity', 'purge_guard_owner')
    ),
    'the ephemeral identity can authenticate but the procedure owner cannot and neither is role-granted'
);
SELECT ok(
    has_function_privilege('purge_identity', 'private.purge_personal_data_batch(text,integer)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'private.purge_personal_data_batch(text,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.purge_personal_data_batch(text,integer)', 'EXECUTE'),
    'only the dedicated database identity can invoke the fixed batch procedure'
);
SELECT like(
    pg_catalog.pg_get_functiondef('private.guard_personal_data_write()'::regprocedure),
    '%pg_advisory_xact_lock_shared(7123341, 2809)%',
    'every guarded write participates in the shared drain lock'
);
SELECT like(
    pg_catalog.pg_get_functiondef('private.activate_personal_data_write_freeze(text)'::regprocedure),
    '%pg_advisory_xact_lock(7123341, 2809)%',
    'freeze activation takes the matching exclusive drain lock'
);
SELECT ok(
    pg_catalog.position('session_user = v_storage_principal' IN pg_catalog.pg_get_functiondef('private.guard_personal_data_write()'::regprocedure)) > 0
    AND pg_catalog.position('auth.uid() = v_storage_user' IN pg_catalog.pg_get_functiondef('private.guard_personal_data_write()'::regprocedure)) > 0,
    'Storage delete exception binds the observed DB principal and authenticated utility user'
);
SELECT is(
    private.attest_personal_data_tus_quiescence('yum-overhaul-20260928', repeat('a', 64)),
    false,
    'unsupported TUS session inventory keeps purge fail-closed'
);

SELECT ok(
    NOT (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = 'purge_guard_owner')
    AND (SELECT count(*) FROM pg_catalog.pg_policies
         WHERE policyname = 'purge_guard_exact_run_read'
           AND schemaname IN ('public', 'private')) = 15,
    'the NO-BYPASSRLS procedure owner receives exact-run read policies for every fixed personal relation'
);
SELECT like(
    (SELECT qual FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename = 'reviews'
       AND policyname = 'purge_guard_exact_run_delete'),
    '%purge_guard_row_is_allowlisted%',
    'personal-row deletes remain limited to unconsumed exact-run allowlist entries'
);
SELECT like(
    (SELECT qual FROM pg_catalog.pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'purge_guard_exact_run_storage_read'),
    '%yum-review-media%',
    'Storage verification reads are restricted to the application media bucket during the exact run'
);

SELECT * FROM finish();
ROLLBACK;
