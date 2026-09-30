-- Inactive-by-default write freeze and exact-run personal-data purge controls.
-- This migration installs controls only; it never activates a purge.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'purge_guard_owner') THEN
        -- PostgreSQL 17 can give the CREATEROLE operator a self-membership.
        -- Enable it only for this owner role; purge_identity must not inherit it.
        SET LOCAL createrole_self_grant = 'set';
        EXECUTE 'CREATE ROLE purge_guard_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
        SET LOCAL createrole_self_grant = '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'purge_identity') THEN
        EXECUTE 'CREATE ROLE purge_identity LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'purge_guard_owner'
          AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls OR rolcanlogin)
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'purge_identity'
          AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls OR NOT rolcanlogin)
    ) THEN
        RAISE EXCEPTION 'procedure owner must be NOLOGIN and purge_identity must be a restricted LOGIN';
    END IF;
    IF NOT pg_catalog.pg_has_role('postgres', 'purge_guard_owner', 'SET') THEN
        RAISE EXCEPTION 'postgres must be able to SET ROLE to purge_guard_owner';
    END IF;
    -- PG17's immutable CREATEROLE bootstrap edge and the deliberately enabled
    -- guard-owner SET self-grant are the only accepted memberships.
    IF (SELECT count(*) FROM pg_catalog.pg_auth_members m
        JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
        JOIN pg_catalog.pg_roles u ON u.oid = m.member
        WHERE r.rolname IN ('purge_guard_owner', 'purge_identity')
           OR u.rolname IN ('purge_guard_owner', 'purge_identity')) <> 3
       OR (SELECT count(*) FROM pg_catalog.pg_auth_members m
           JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
           JOIN pg_catalog.pg_roles u ON u.oid = m.member
           WHERE r.rolname = 'purge_guard_owner' AND u.rolname = 'postgres'
             AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) <> 1
       OR (SELECT count(*) FROM pg_catalog.pg_auth_members m
           JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
           JOIN pg_catalog.pg_roles u ON u.oid = m.member
           WHERE r.rolname = 'purge_guard_owner' AND u.rolname = 'postgres'
             AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option) <> 1
       OR (SELECT count(*) FROM pg_catalog.pg_auth_members m
           JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
           JOIN pg_catalog.pg_roles u ON u.oid = m.member
           WHERE r.rolname = 'purge_identity' AND u.rolname = 'postgres'
             AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) <> 1
       OR EXISTS (
        SELECT 1 FROM (
            SELECT r.rolname AS granted_role, u.rolname AS member_role,
                   m.admin_option, m.inherit_option, m.set_option
            FROM pg_catalog.pg_auth_members m
            JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
            JOIN pg_catalog.pg_roles u ON u.oid = m.member
            WHERE r.rolname IN ('purge_guard_owner', 'purge_identity')
               OR u.rolname IN ('purge_guard_owner', 'purge_identity')
        ) actual
        WHERE NOT (
            (actual.granted_role = 'purge_guard_owner' AND actual.member_role = 'postgres'
             AND actual.admin_option AND NOT actual.inherit_option AND NOT actual.set_option)
         OR (actual.granted_role = 'purge_guard_owner' AND actual.member_role = 'postgres'
             AND NOT actual.admin_option AND NOT actual.inherit_option AND actual.set_option)
         OR (actual.granted_role = 'purge_identity' AND actual.member_role = 'postgres'
             AND actual.admin_option AND NOT actual.inherit_option AND NOT actual.set_option)
        )
    ) THEN
        RAISE EXCEPTION 'purge roles have unexpected PostgreSQL membership edges or options';
    END IF;
END;
$roles$;

CREATE TABLE private.personal_data_write_freeze (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    active_run_id text,
    frozen_at timestamptz,
    CONSTRAINT ck_personal_data_write_freeze_state CHECK (
        (active_run_id IS NULL AND frozen_at IS NULL)
        OR (active_run_id = 'yum-overhaul-20260928' AND frozen_at IS NOT NULL)
    )
);
INSERT INTO private.personal_data_write_freeze (singleton, active_run_id, frozen_at)
VALUES (true, NULL, NULL);

CREATE TABLE private.personal_data_purge_runs (
    run_id text PRIMARY KEY CHECK (run_id = 'yum-overhaul-20260928'),
    state text NOT NULL CHECK (state IN ('FROZEN', 'SNAPSHOTTED', 'PURGING', 'COMPLETE')),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    storage_user_id uuid,
    storage_session_user name,
    storage_context_verified boolean NOT NULL DEFAULT false,
    tus_quiescence_verified boolean NOT NULL DEFAULT false,
    tus_evidence_digest text,
    key_secret bytea CHECK (key_secret IS NULL OR pg_catalog.octet_length(key_secret) = 32),
    catalog_restaurant_count bigint,
    catalog_restaurant_hmac text,
    catalog_menu_count bigint,
    catalog_menu_hmac text,
    menu_asset_count bigint,
    menu_asset_hmac text,
    CONSTRAINT ck_purge_tus_digest CHECK (tus_evidence_digest IS NULL OR tus_evidence_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_purge_catalog_hmacs CHECK (
        (catalog_restaurant_hmac IS NULL OR catalog_restaurant_hmac ~ '^[0-9a-f]{64}$')
        AND (catalog_menu_hmac IS NULL OR catalog_menu_hmac ~ '^[0-9a-f]{64}$')
        AND (menu_asset_hmac IS NULL OR menu_asset_hmac ~ '^[0-9a-f]{64}$')
    )
);

-- Raw keys and exact object paths live only in this private control table so the
-- fixed procedures can act on the sealed active-run set. The journal below has
-- aggregate counts and keyed digests only.
CREATE TABLE private.personal_data_purge_allowlist (
    run_id text NOT NULL REFERENCES private.personal_data_purge_runs(run_id) ON DELETE CASCADE,
    relation_name text NOT NULL,
    row_key text NOT NULL,
    scope text NOT NULL CHECK (scope IN ('ROW', 'REVIEW_MEDIA', 'REVIEW_RIGHTS', 'MENU_ATTRIBUTION')),
    object_path text,
    key_hmac text NOT NULL CHECK (key_hmac ~ '^[0-9a-f]{64}$'),
    consumed_at timestamptz,
    PRIMARY KEY (run_id, relation_name, row_key, scope),
    CONSTRAINT ck_purge_allowlist_storage_path CHECK (
        (relation_name = 'storage.objects' AND object_path IS NOT NULL)
        OR (relation_name <> 'storage.objects' AND object_path IS NULL)
    )
);
CREATE INDEX idx_personal_data_purge_allowlist_pending
    ON private.personal_data_purge_allowlist (run_id, relation_name, scope, row_key)
    WHERE consumed_at IS NULL;

CREATE TABLE private.personal_data_write_freeze_step_journal (
    run_id text NOT NULL REFERENCES private.personal_data_purge_runs(run_id) ON DELETE CASCADE,
    step_name text NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING', 'STARTED', 'COMMITTED')),
    rows_affected bigint NOT NULL DEFAULT 0 CHECK (rows_affected >= 0),
    keyed_hmac text,
    started_at timestamptz,
    committed_at timestamptz,
    PRIMARY KEY (run_id, step_name),
    CONSTRAINT ck_personal_data_write_freeze_step_journal_digest CHECK (keyed_hmac IS NULL OR keyed_hmac ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_personal_data_write_freeze_step_journal_state CHECK (
        (status = 'PENDING' AND started_at IS NULL AND committed_at IS NULL)
        OR (status = 'STARTED' AND started_at IS NOT NULL AND committed_at IS NULL)
        OR (status = 'COMMITTED' AND started_at IS NOT NULL AND committed_at IS NOT NULL)
    )
);

CREATE TABLE private.personal_data_storage_principal_observations (
    principal_name name PRIMARY KEY,
    observed_count bigint NOT NULL DEFAULT 1,
    first_observed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    last_observed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

-- Retained MENU assets keep their existing object path, metadata, and bytes. The
-- uploader FK becomes nullable only for the exact-run attribution-clearing step.
ALTER TABLE public.media_assets ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE public.media_assets DROP CONSTRAINT ck_media_assets_object_path;
ALTER TABLE public.media_assets ADD CONSTRAINT ck_media_assets_object_path CHECK (
    (media_kind = 'MENU' AND object_path ~ '^menu/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$')
    OR (media_kind = 'REVIEW' AND uploaded_by IS NOT NULL AND object_path =
        'review/' || uploaded_by::text || '/' || id::text ||
        CASE content_type WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END)
);

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role, purge_identity;
GRANT USAGE ON SCHEMA private, auth, storage, public TO purge_guard_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role, purge_identity;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    private.personal_data_write_freeze,
    private.personal_data_purge_runs,
    private.personal_data_purge_allowlist,
    private.personal_data_write_freeze_step_journal,
    private.personal_data_storage_principal_observations
TO purge_guard_owner;

CREATE OR REPLACE FUNCTION private.personal_data_write_is_frozen()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT COALESCE((SELECT f.active_run_id IS NOT NULL
                     FROM private.personal_data_write_freeze AS f
                     WHERE f.singleton), false);
$$;

CREATE OR REPLACE FUNCTION public.personal_data_write_is_frozen()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT private.personal_data_write_is_frozen();
$$;

CREATE OR REPLACE FUNCTION private.purge_key_hmac(p_run_id text, p_relation text, p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT pg_catalog.encode(
        extensions.hmac(
            pg_catalog.convert_to(p_relation || ':' || p_key, 'UTF8'),
            r.key_secret,
            'sha256'
        ),
        'hex'
    )
    FROM private.personal_data_purge_runs AS r
    WHERE r.run_id = p_run_id;
$$;

CREATE OR REPLACE FUNCTION private.capture_purge_storage_principal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Only a real Storage API insert by the pre-provisioned utility Auth user is
    -- eligible. Raw SQL can forge JWT GUCs, but cannot forge session_user.
    IF TG_OP = 'INSERT'
       AND NOT private.personal_data_write_is_frozen()
       AND COALESCE(auth.jwt() ->> 'role', '') = 'authenticated'
       AND EXISTS (
           SELECT 1 FROM auth.users AS u
           WHERE u.id = auth.uid()
             AND u.raw_app_meta_data ->> 'personal_data_purge_run' = 'yum-overhaul-20260928'
       )
       AND session_user <> ALL (ARRAY['postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role', 'authenticator']::name[])
    THEN
        INSERT INTO private.personal_data_storage_principal_observations (principal_name)
        VALUES (session_user)
        ON CONFLICT (principal_name) DO UPDATE
        SET observed_count = private.personal_data_storage_principal_observations.observed_count + 1,
            last_observed_at = pg_catalog.clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_personal_data_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_relation text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
    v_run_id text;
    v_scope text := 'ROW';
    v_key text;
    v_old jsonb;
    v_new jsonb;
    v_storage_user uuid;
    v_storage_principal name;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(7123341, 2809);
    SELECT f.active_run_id INTO v_run_id
    FROM private.personal_data_write_freeze AS f
    WHERE f.singleton;
    IF v_run_id IS NULL THEN
        IF v_relation = 'storage.objects' AND TG_OP = 'INSERT' THEN
            RETURN NEW;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF v_relation IN ('public.restaurants', 'public.menus') THEN
        RAISE EXCEPTION 'personal data write freeze is active' USING ERRCODE = '55000';
    END IF;

    IF TG_OP <> 'INSERT' THEN v_old := pg_catalog.to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN v_new := pg_catalog.to_jsonb(NEW); END IF;

    IF TG_OP = 'DELETE' THEN
        v_key := CASE v_relation
            WHEN 'auth.users' THEN v_old ->> 'id'
            WHEN 'public.profiles' THEN v_old ->> 'user_id'
            WHEN 'private.legacy_user_identity' THEN v_old ->> 'legacy_user_id'
            WHEN 'private.user_roles' THEN (v_old ->> 'user_id') || ':' || (v_old ->> 'role_code')
            WHEN 'private.restaurant_owners' THEN (v_old ->> 'user_id') || ':' || (v_old ->> 'restaurant_id')
            WHEN 'private.legacy_media_rights' THEN v_old ->> 'legacy_media_id'
            WHEN 'public.reviews' THEN v_old ->> 'id'
            WHEN 'public.review_photos' THEN (v_old ->> 'review_id') || ':' || (v_old ->> 'media_id')
            WHEN 'public.review_likes' THEN (v_old ->> 'user_id') || ':' || (v_old ->> 'review_id')
            WHEN 'public.menu_wishlists' THEN (v_old ->> 'user_id') || ':' || (v_old ->> 'menu_id')
            WHEN 'public.media_assets' THEN v_old ->> 'id'
            WHEN 'private.legacy_media_asset_identity' THEN v_old ->> 'legacy_media_id'
            WHEN 'private.consumed_media_verification_proofs' THEN v_old ->> 'nonce'
            WHEN 'private.media_verification_rate_limits' THEN v_old ->> 'user_id'
            WHEN 'private.media_verification_quotas' THEN v_old ->> 'user_id'
            WHEN 'private.media_verification_leases' THEN v_old ->> 'lease_digest'
            WHEN 'storage.objects' THEN (v_old ->> 'bucket_id') || ':' || (v_old ->> 'name')
            ELSE NULL
        END;
        v_scope := CASE v_relation
            WHEN 'public.media_assets' THEN 'REVIEW_MEDIA'
            WHEN 'private.legacy_media_rights' THEN 'REVIEW_RIGHTS'
            ELSE 'ROW'
        END;
    ELSE
        v_key := CASE v_relation
            WHEN 'auth.users' THEN v_new ->> 'id'
            WHEN 'public.profiles' THEN v_new ->> 'user_id'
            WHEN 'private.legacy_user_identity' THEN v_new ->> 'legacy_user_id'
            WHEN 'private.user_roles' THEN (v_new ->> 'user_id') || ':' || (v_new ->> 'role_code')
            WHEN 'private.restaurant_owners' THEN (v_new ->> 'user_id') || ':' || (v_new ->> 'restaurant_id')
            WHEN 'private.legacy_media_rights' THEN v_new ->> 'legacy_media_id'
            WHEN 'public.reviews' THEN v_new ->> 'id'
            WHEN 'public.review_photos' THEN (v_new ->> 'review_id') || ':' || (v_new ->> 'media_id')
            WHEN 'public.review_likes' THEN (v_new ->> 'user_id') || ':' || (v_new ->> 'review_id')
            WHEN 'public.menu_wishlists' THEN (v_new ->> 'user_id') || ':' || (v_new ->> 'menu_id')
            WHEN 'public.media_assets' THEN v_new ->> 'id'
            WHEN 'private.legacy_media_asset_identity' THEN v_new ->> 'legacy_media_id'
            WHEN 'private.consumed_media_verification_proofs' THEN v_new ->> 'nonce'
            WHEN 'private.media_verification_rate_limits' THEN v_new ->> 'user_id'
            WHEN 'private.media_verification_quotas' THEN v_new ->> 'user_id'
            WHEN 'private.media_verification_leases' THEN v_new ->> 'lease_digest'
            WHEN 'storage.objects' THEN (v_new ->> 'bucket_id') || ':' || (v_new ->> 'name')
            ELSE NULL
        END;
    END IF;

    IF v_relation = 'storage.objects' THEN
        IF TG_OP <> 'DELETE' THEN
            RAISE EXCEPTION 'personal data write freeze is active' USING ERRCODE = '55000';
        END IF;
        SELECT r.storage_user_id, r.storage_session_user
          INTO v_storage_user, v_storage_principal
        FROM private.personal_data_purge_runs AS r
        WHERE r.run_id = v_run_id;
        IF session_user = v_storage_principal
           AND v_storage_principal IS NOT NULL
           AND COALESCE(auth.jwt() ->> 'role', '') = 'authenticated'
           AND auth.uid() = v_storage_user
           AND v_storage_user IS NOT NULL
           AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
           AND OLD.bucket_id = 'yum-review-media'
           AND EXISTS (
               SELECT 1
               FROM private.personal_data_purge_runs AS r
               JOIN private.personal_data_purge_allowlist AS a
                 ON a.run_id = r.run_id
                AND a.relation_name = 'storage.objects'
                AND a.scope = 'REVIEW_MEDIA'
                AND a.object_path = OLD.name
                AND a.consumed_at IS NULL
               JOIN public.media_assets AS asset
                 ON asset.object_path = a.object_path
                AND asset.media_kind = 'REVIEW'
                AND asset.lifecycle_status = 'DELETE_PENDING'
               WHERE r.run_id = v_run_id
                 AND r.storage_context_verified
                 AND r.tus_quiescence_verified
                 AND NOT EXISTS (
                     SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = asset.id
                 )
           )
        THEN
            UPDATE private.personal_data_purge_allowlist
            SET consumed_at = pg_catalog.clock_timestamp()
            WHERE run_id = v_run_id AND relation_name = 'storage.objects'
              AND scope = 'REVIEW_MEDIA' AND object_path = OLD.name AND consumed_at IS NULL;
            IF NOT FOUND THEN RAISE EXCEPTION 'storage purge path was already consumed'; END IF;
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'storage delete is not an allowlisted active-run REVIEW purge' USING ERRCODE = '42501';
    END IF;

    IF v_relation = 'auth.users' THEN
        IF TG_OP = 'DELETE'
           AND session_user = 'purge_identity'
           AND EXISTS (
               SELECT 1 FROM private.personal_data_purge_allowlist AS a
               WHERE a.run_id = v_run_id AND a.relation_name = v_relation
                 AND a.row_key = v_key AND a.scope = 'ROW' AND a.consumed_at IS NULL
           ) THEN
            UPDATE private.personal_data_purge_allowlist
            SET consumed_at = pg_catalog.clock_timestamp()
            WHERE run_id = v_run_id AND relation_name = v_relation AND row_key = v_key
              AND scope = 'ROW' AND consumed_at IS NULL;
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Auth writes are frozen; only exact-run purge_identity DELETE is permitted' USING ERRCODE = '42501';
    END IF;

    IF v_relation = 'public.media_assets' AND TG_OP = 'UPDATE'
       AND session_user = 'purge_identity'
       AND OLD.media_kind = 'REVIEW'
       AND NEW.media_kind = OLD.media_kind
       AND NEW.lifecycle_status = 'DELETE_PENDING'
       AND (to_jsonb(NEW) - 'lifecycle_status') = (to_jsonb(OLD) - 'lifecycle_status')
       AND EXISTS (
           SELECT 1 FROM private.personal_data_purge_allowlist AS a
           WHERE a.run_id = v_run_id AND a.relation_name = v_relation
             AND a.row_key = OLD.id::text AND a.scope = 'REVIEW_MEDIA' AND a.consumed_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    IF v_relation = 'public.media_assets' AND TG_OP = 'UPDATE'
       AND session_user = 'purge_identity'
       AND OLD.media_kind = 'MENU'
       AND NEW.uploaded_by IS NULL
       AND (to_jsonb(NEW) - 'uploaded_by') = (to_jsonb(OLD) - 'uploaded_by')
       AND EXISTS (
           SELECT 1 FROM private.personal_data_purge_allowlist AS a
           WHERE a.run_id = v_run_id AND a.relation_name = v_relation
             AND a.row_key = OLD.id::text AND a.scope = 'MENU_ATTRIBUTION' AND a.consumed_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    IF v_relation = 'private.legacy_media_rights' AND TG_OP = 'UPDATE'
       AND session_user = 'purge_identity'
       AND OLD.rights_attested_legacy_user_id IS NOT NULL
       AND NEW.rights_attested_legacy_user_id IS NULL
       AND (to_jsonb(NEW) - 'rights_attested_legacy_user_id') = (to_jsonb(OLD) - 'rights_attested_legacy_user_id')
       AND EXISTS (
           SELECT 1 FROM private.personal_data_purge_allowlist AS a
           WHERE a.run_id = v_run_id AND a.relation_name = v_relation
             AND a.row_key = OLD.legacy_media_id AND a.scope = 'MENU_ATTRIBUTION' AND a.consumed_at IS NULL
       ) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE'
       AND session_user = 'purge_identity'
       AND EXISTS (
           SELECT 1 FROM private.personal_data_purge_allowlist AS a
           WHERE a.run_id = v_run_id AND a.relation_name = v_relation
             AND a.row_key = v_key AND a.scope = v_scope AND a.consumed_at IS NULL
       ) THEN
        IF v_relation = 'public.media_assets'
           AND (OLD.media_kind <> 'REVIEW'
                OR EXISTS (
                    SELECT 1 FROM private.personal_data_purge_allowlist AS storage_allow
                    WHERE storage_allow.run_id = v_run_id
                      AND storage_allow.relation_name = 'storage.objects'
                      AND storage_allow.scope = 'REVIEW_MEDIA'
                      AND storage_allow.row_key = 'yum-review-media:' || OLD.object_path
                      AND storage_allow.consumed_at IS NULL
                )
                OR EXISTS (SELECT 1 FROM storage.objects AS o WHERE o.bucket_id = 'yum-review-media' AND o.name = OLD.object_path)) THEN
            RAISE EXCEPTION 'REVIEW media bytes must be removed through the official Storage API first';
        END IF;
        UPDATE private.personal_data_purge_allowlist
        SET consumed_at = pg_catalog.clock_timestamp()
        WHERE run_id = v_run_id AND relation_name = v_relation AND row_key = v_key
          AND scope = v_scope AND consumed_at IS NULL;
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'personal data write freeze is active' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_personal_data_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(7123341, 2809);
    IF private.personal_data_write_is_frozen() THEN
        RAISE EXCEPTION 'personal data write freeze blocks TRUNCATE' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_storage_upload_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(7123341, 2809);
    IF private.personal_data_write_is_frozen() THEN
        RAISE EXCEPTION 'personal data write freeze blocks Storage upload sessions and chunks' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

-- PostgreSQL requires schema CREATE for SET ROLE ownership transfers. Keep the
-- temporary privilege only around those transfers and prove it is removed.
GRANT CREATE ON SCHEMA private, public TO purge_guard_owner;
ALTER FUNCTION private.personal_data_write_is_frozen() OWNER TO purge_guard_owner;
ALTER FUNCTION public.personal_data_write_is_frozen() OWNER TO purge_guard_owner;
ALTER FUNCTION private.purge_key_hmac(text, text, text) OWNER TO purge_guard_owner;
ALTER FUNCTION private.capture_purge_storage_principal() OWNER TO purge_guard_owner;
ALTER FUNCTION private.guard_personal_data_write() OWNER TO purge_guard_owner;
ALTER FUNCTION private.guard_personal_data_truncate() OWNER TO purge_guard_owner;
ALTER FUNCTION private.guard_storage_upload_state() OWNER TO purge_guard_owner;
REVOKE ALL ON FUNCTION private.personal_data_write_is_frozen() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.purge_key_hmac(text, text, text) FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.capture_purge_storage_principal() FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.guard_personal_data_write() FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.guard_personal_data_truncate() FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.guard_storage_upload_state() FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION public.personal_data_write_is_frozen() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.personal_data_write_is_frozen() TO anon, authenticated, service_role;

DO $install_guards$
DECLARE
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'auth.users',
        'public.profiles', 'private.legacy_user_identity', 'private.user_roles',
        'private.restaurant_owners', 'private.legacy_media_rights',
        'public.reviews', 'public.review_photos', 'public.review_likes',
        'public.menu_wishlists', 'public.media_assets', 'private.legacy_media_asset_identity',
        'private.consumed_media_verification_proofs', 'private.media_verification_rate_limits',
        'private.media_verification_quotas', 'private.media_verification_leases',
        'public.restaurants', 'public.menus', 'storage.objects'
    ] LOOP
        EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS trg_personal_data_write_freeze ON %s', v_table);
        EXECUTE pg_catalog.format(
            'CREATE TRIGGER trg_personal_data_write_freeze BEFORE INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION private.guard_personal_data_write()',
            v_table
        );
        EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS trg_personal_data_write_freeze_truncate ON %s', v_table);
        EXECUTE pg_catalog.format(
            'CREATE TRIGGER trg_personal_data_write_freeze_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION private.guard_personal_data_truncate()',
            v_table
        );
    END LOOP;

    -- These internal Storage tables vary by local/managed Storage release. When
    -- present, deny new sessions, chunks, finalization, and cancellation while
    -- frozen. Purge remains blocked until their state is independently inventoried.
    IF pg_catalog.to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN
        EXECUTE 'CREATE TRIGGER trg_personal_data_freeze_s3_uploads BEFORE INSERT OR UPDATE OR DELETE ON storage.s3_multipart_uploads FOR EACH ROW EXECUTE FUNCTION private.guard_storage_upload_state()';
        EXECUTE 'CREATE TRIGGER trg_personal_data_freeze_s3_uploads_truncate BEFORE TRUNCATE ON storage.s3_multipart_uploads FOR EACH STATEMENT EXECUTE FUNCTION private.guard_personal_data_truncate()';
    END IF;
    IF pg_catalog.to_regclass('storage.s3_multipart_uploads_parts') IS NOT NULL THEN
        EXECUTE 'CREATE TRIGGER trg_personal_data_freeze_s3_upload_parts BEFORE INSERT OR UPDATE OR DELETE ON storage.s3_multipart_uploads_parts FOR EACH ROW EXECUTE FUNCTION private.guard_storage_upload_state()';
        EXECUTE 'CREATE TRIGGER trg_personal_data_freeze_s3_upload_parts_truncate BEFORE TRUNCATE ON storage.s3_multipart_uploads_parts FOR EACH STATEMENT EXECUTE FUNCTION private.guard_personal_data_truncate()';
    END IF;
END;
$install_guards$;

CREATE TRIGGER trg_observe_purge_storage_principal
    BEFORE INSERT ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION private.capture_purge_storage_principal();

CREATE OR REPLACE FUNCTION private.storage_delete_allowed(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_run_id text;
BEGIN
    SELECT f.active_run_id INTO v_run_id
    FROM private.personal_data_write_freeze AS f WHERE f.singleton;
    IF v_run_id IS NULL THEN
        RETURN p_bucket = 'yum-review-media' AND private.can_delete_media_path(p_name);
    END IF;
    RETURN p_bucket = 'yum-review-media'
       AND COALESCE(auth.jwt() ->> 'role', '') = 'authenticated'
       AND auth.uid() = (SELECT r.storage_user_id FROM private.personal_data_purge_runs AS r WHERE r.run_id = v_run_id)
       AND EXISTS (
           SELECT 1
           FROM private.personal_data_purge_runs AS r
           JOIN private.personal_data_purge_allowlist AS a
             ON a.run_id = r.run_id AND a.relation_name = 'storage.objects'
            AND a.scope = 'REVIEW_MEDIA' AND a.object_path = p_name AND a.consumed_at IS NULL
           JOIN public.media_assets AS asset ON asset.object_path = p_name
            AND asset.media_kind = 'REVIEW' AND asset.lifecycle_status = 'DELETE_PENDING'
           WHERE r.run_id = v_run_id AND r.storage_context_verified AND r.tus_quiescence_verified
             AND NOT EXISTS (SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = asset.id)
       );
END;
$$;

ALTER FUNCTION private.storage_delete_allowed(text, text) OWNER TO purge_guard_owner;
REVOKE ALL ON FUNCTION private.storage_delete_allowed(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.storage_delete_allowed(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_delete_media_path(text) TO purge_guard_owner;

DROP POLICY IF EXISTS yum_review_media_authorized_upload ON storage.objects;
CREATE POLICY yum_review_media_authorized_upload ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'yum-review-media'
        AND NOT public.personal_data_write_is_frozen()
        AND private.can_upload_media_path(name)
    );
DROP POLICY IF EXISTS yum_review_media_unlinked_delete ON storage.objects;
CREATE POLICY yum_review_media_unlinked_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (private.storage_delete_allowed(bucket_id, name));

CREATE OR REPLACE FUNCTION private.activate_personal_data_write_freeze(p_run_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928' THEN
        RAISE EXCEPTION 'only the project-owner operator may activate this exact run';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(7123341, 2809);
    IF EXISTS (SELECT 1 FROM private.personal_data_write_freeze WHERE singleton AND active_run_id IS NOT NULL) THEN
        RAISE EXCEPTION 'another personal-data freeze run is already active';
    END IF;
    INSERT INTO private.personal_data_purge_runs (run_id, state, key_secret)
    VALUES (p_run_id, 'FROZEN', extensions.gen_random_bytes(32))
    ON CONFLICT (run_id) DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'the exact-run purge checkpoint already exists; resume forward instead of resetting its key or journal';
    END IF;
    DELETE FROM private.personal_data_purge_allowlist WHERE run_id = p_run_id;
    DELETE FROM private.personal_data_write_freeze_step_journal WHERE run_id = p_run_id;
    UPDATE private.personal_data_write_freeze
       SET active_run_id = p_run_id, frozen_at = pg_catalog.clock_timestamp()
     WHERE singleton;
END;
$$;

CREATE OR REPLACE FUNCTION private.bind_personal_data_purge_storage_context()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_run_id text;
    v_user_id uuid;
    v_principal name;
BEGIN
    IF session_user <> 'postgres' THEN RAISE EXCEPTION 'operator procedure only'; END IF;
    SELECT active_run_id INTO v_run_id FROM private.personal_data_write_freeze WHERE singleton;
    IF v_run_id IS NULL THEN RAISE EXCEPTION 'freeze must be active before binding purge Storage identity'; END IF;
    SELECT u.id INTO v_user_id
    FROM auth.users AS u
    WHERE u.raw_app_meta_data ->> 'personal_data_purge_run' = v_run_id
      AND NOT EXISTS (SELECT 1 FROM private.user_roles AS ur WHERE ur.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM private.restaurant_owners AS ro WHERE ro.user_id = u.id);
    IF v_user_id IS NULL OR (SELECT count(*) FROM auth.users AS u
        WHERE u.raw_app_meta_data ->> 'personal_data_purge_run' = v_run_id) <> 1 THEN
        RETURN false;
    END IF;
    SELECT pg_catalog.min(o.principal_name) INTO v_principal
    FROM private.personal_data_storage_principal_observations AS o
    JOIN pg_catalog.pg_roles AS principal ON principal.rolname = o.principal_name
    WHERE o.principal_name NOT IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role', 'authenticator')
      AND principal.rolcanlogin
      AND NOT (principal.rolsuper OR principal.rolbypassrls OR principal.rolcreaterole)
      AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_auth_members AS m
          JOIN pg_catalog.pg_roles AS granted ON granted.oid = m.roleid
          JOIN pg_catalog.pg_roles AS member ON member.oid = m.member
          WHERE granted.rolname = o.principal_name OR member.rolname = o.principal_name
      )
    HAVING count(*) = 1;
    IF v_principal IS NULL THEN RETURN false; END IF;
    UPDATE private.personal_data_purge_runs
       SET storage_user_id = v_user_id,
           storage_session_user = v_principal,
           storage_context_verified = true
     WHERE run_id = v_run_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION private.attest_personal_data_tus_quiescence(p_run_id text, p_evidence_digest text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_run_id text;
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928'
       OR p_evidence_digest !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'TUS quiescence requires the project-owner exact-run evidence attestation';
    END IF;
    SELECT active_run_id INTO v_run_id FROM private.personal_data_write_freeze WHERE singleton;
    IF v_run_id <> p_run_id THEN RAISE EXCEPTION 'active purge run mismatch'; END IF;
    -- The Storage TUS handler can hold resumable state outside Postgres, so the
    -- available DB tables cannot prove that sessions and chunks are drained.
    -- Keep the gate false until a reviewed Storage API inventory/cancel probe is
    -- supplied; an operator-supplied digest alone is not quiescence proof.
    RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.snapshot_personal_data_purge_allowlists(p_run_id text)
RETURNS TABLE (relation_count bigint, allowlisted_rows bigint, keyed_hmac text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_secret bytea;
    v_count bigint;
    v_relation_count bigint;
    v_digest text;
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928' THEN
        RAISE EXCEPTION 'operator procedure requires the exact approved run';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM private.personal_data_write_freeze WHERE singleton AND active_run_id = p_run_id) THEN
        RAISE EXCEPTION 'write freeze is not active for the exact run';
    END IF;
    SELECT key_secret INTO v_secret FROM private.personal_data_purge_runs WHERE run_id = p_run_id FOR UPDATE;
    IF v_secret IS NULL THEN RAISE EXCEPTION 'purge key unavailable'; END IF;
    IF EXISTS (SELECT 1 FROM private.personal_data_write_freeze_step_journal WHERE run_id = p_run_id) THEN
        RAISE EXCEPTION 'allowlists already snapshotted for this run';
    END IF;

    INSERT INTO private.personal_data_purge_allowlist (run_id, relation_name, row_key, scope, key_hmac)
    SELECT p_run_id, 'auth.users', u.id::text, 'ROW',
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('auth.users:' || u.id::text, 'UTF8'), v_secret, 'sha256'), 'hex')
    FROM auth.users AS u;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'public.profiles', p.user_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('public.profiles:' || p.user_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM public.profiles AS p;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.legacy_user_identity', i.legacy_user_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.legacy_user_identity:' || i.legacy_user_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.legacy_user_identity AS i;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.user_roles', r.user_id::text || ':' || r.role_code, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.user_roles:' || r.user_id::text || ':' || r.role_code, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.user_roles AS r;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.restaurant_owners', r.user_id::text || ':' || r.restaurant_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.restaurant_owners:' || r.user_id::text || ':' || r.restaurant_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.restaurant_owners AS r;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.legacy_media_rights', r.legacy_media_id, 'REVIEW_RIGHTS', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.legacy_media_rights:' || r.legacy_media_id, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.legacy_media_rights AS r
    JOIN private.legacy_media_asset_identity AS i ON i.legacy_media_id = r.legacy_media_id
    JOIN public.media_assets AS m ON m.id = i.media_id
    WHERE m.media_kind = 'REVIEW';
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.legacy_media_rights', r.legacy_media_id, 'MENU_ATTRIBUTION', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.legacy_media_rights:' || r.legacy_media_id, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.legacy_media_rights AS r
    JOIN private.legacy_media_asset_identity AS i ON i.legacy_media_id = r.legacy_media_id
    JOIN public.media_assets AS m ON m.id = i.media_id
    WHERE m.media_kind = 'MENU' AND r.rights_attested_legacy_user_id IS NOT NULL;
    IF EXISTS (
        SELECT 1 FROM private.legacy_media_rights AS r
        WHERE NOT EXISTS (SELECT 1 FROM private.legacy_media_asset_identity AS i WHERE i.legacy_media_id = r.legacy_media_id)
    ) THEN RAISE EXCEPTION 'legacy media rights contain an unmapped media row'; END IF;

    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'public.reviews', r.id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('public.reviews:' || r.id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM public.reviews AS r;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'public.review_photos', p.review_id::text || ':' || p.media_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('public.review_photos:' || p.review_id::text || ':' || p.media_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM public.review_photos AS p;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'public.review_likes', l.user_id::text || ':' || l.review_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('public.review_likes:' || l.user_id::text || ':' || l.review_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM public.review_likes AS l;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'public.menu_wishlists', w.user_id::text || ':' || w.menu_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('public.menu_wishlists:' || w.user_id::text || ':' || w.menu_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM public.menu_wishlists AS w;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'public.media_assets', a.id::text,
           CASE WHEN a.media_kind = 'MENU' THEN 'MENU_ATTRIBUTION' ELSE 'REVIEW_MEDIA' END,
           NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('public.media_assets:' || a.id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM public.media_assets AS a
    WHERE (a.media_kind = 'REVIEW') OR (a.media_kind = 'MENU' AND a.uploaded_by IS NOT NULL);
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'storage.objects', 'yum-review-media:' || a.object_path, 'REVIEW_MEDIA', a.object_path,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('storage.objects:' || a.object_path, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM public.media_assets AS a
    WHERE a.media_kind = 'REVIEW';
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.legacy_media_asset_identity', i.legacy_media_id, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.legacy_media_asset_identity:' || i.legacy_media_id, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.legacy_media_asset_identity AS i;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.consumed_media_verification_proofs', p.nonce::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.consumed_media_verification_proofs:' || p.nonce::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.consumed_media_verification_proofs AS p;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.media_verification_rate_limits', r.user_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.media_verification_rate_limits:' || r.user_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.media_verification_rate_limits AS r;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.media_verification_quotas', q.user_id::text, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.media_verification_quotas:' || q.user_id::text, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.media_verification_quotas AS q;
    INSERT INTO private.personal_data_purge_allowlist
    SELECT p_run_id, 'private.media_verification_leases', l.lease_digest, 'ROW', NULL,
           pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('private.media_verification_leases:' || l.lease_digest, 'UTF8'), v_secret, 'sha256'), 'hex'), NULL
    FROM private.media_verification_leases AS l;

    SELECT count(DISTINCT relation_name), count(*),
           pg_catalog.encode(extensions.hmac(
               pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(key_hmac, '' ORDER BY relation_name, key_hmac), ''), 'UTF8'),
               v_secret, 'sha256'), 'hex')
      INTO v_relation_count, v_count, v_digest
    FROM private.personal_data_purge_allowlist WHERE run_id = p_run_id;

    INSERT INTO private.personal_data_write_freeze_step_journal (run_id, step_name, status)
    SELECT p_run_id, step_name, 'PENDING'
    FROM (VALUES
        ('review_media_detach'), ('review_likes'), ('menu_wishlists'), ('reviews'),
        ('review_media_assets'), ('legacy_media_asset_identity'), ('review_legacy_rights'),
        ('consumed_media_verification_proofs'), ('media_verification_rate_limits'),
        ('media_verification_quotas'), ('media_verification_leases'), ('profiles'),
        ('restaurant_owners'), ('user_roles'), ('legacy_user_identity'),
        ('menu_media_attribution'), ('auth_users')
    ) AS steps(step_name);

    SELECT count(*),
           pg_catalog.encode(extensions.hmac(
             pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(r)::text, '' ORDER BY r.id), ''), 'UTF8'),
             v_secret, 'sha256'), 'hex')
      INTO v_count, v_digest FROM public.restaurants AS r;
    UPDATE private.personal_data_purge_runs SET catalog_restaurant_count = v_count, catalog_restaurant_hmac = v_digest WHERE run_id = p_run_id;
    SELECT count(*),
           pg_catalog.encode(extensions.hmac(
             pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(m)::text, '' ORDER BY m.id), ''), 'UTF8'),
             v_secret, 'sha256'), 'hex')
      INTO v_count, v_digest FROM public.menus AS m;
    UPDATE private.personal_data_purge_runs SET catalog_menu_count = v_count, catalog_menu_hmac = v_digest WHERE run_id = p_run_id;
    SELECT count(*),
           pg_catalog.encode(extensions.hmac(
             pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(
                 (pg_catalog.to_jsonb(a) - 'uploaded_by')::text, '' ORDER BY a.id), ''), 'UTF8'),
             v_secret, 'sha256'), 'hex')
      INTO v_count, v_digest
    FROM public.media_assets AS a
    WHERE a.media_kind = 'MENU';
    UPDATE private.personal_data_purge_runs SET menu_asset_count = v_count, menu_asset_hmac = v_digest, state = 'SNAPSHOTTED' WHERE run_id = p_run_id;
    RETURN QUERY SELECT v_relation_count, (SELECT count(*) FROM private.personal_data_purge_allowlist WHERE run_id = p_run_id),
        (SELECT keyed_hmac FROM (SELECT pg_catalog.encode(extensions.hmac(
            pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(key_hmac, '' ORDER BY relation_name, key_hmac), ''), 'UTF8'), v_secret, 'sha256'), 'hex') AS keyed_hmac
         FROM private.personal_data_purge_allowlist WHERE run_id = p_run_id) AS d);
END;
$$;

CREATE OR REPLACE FUNCTION private.next_review_storage_paths(p_run_id text, p_limit integer DEFAULT 100)
RETURNS TABLE (object_path text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_run_id <> 'yum-overhaul-20260928'
       OR session_user <> 'authenticator'
       OR COALESCE(auth.jwt() ->> 'role', '') <> 'authenticated'
       OR auth.uid() IS NULL
       OR auth.uid() <> (SELECT r.storage_user_id FROM private.personal_data_purge_runs AS r WHERE r.run_id = p_run_id)
       OR NOT EXISTS (SELECT 1 FROM private.personal_data_purge_runs AS r WHERE r.run_id = p_run_id AND r.state = 'PURGING' AND r.storage_context_verified AND r.tus_quiescence_verified) THEN
        RAISE EXCEPTION 'only the exact temporary authenticated Storage identity may list purge paths';
    END IF;
    RETURN QUERY
    SELECT a.object_path
    FROM private.personal_data_purge_allowlist AS a
    WHERE a.run_id = p_run_id AND a.relation_name = 'storage.objects'
      AND a.scope = 'REVIEW_MEDIA' AND a.consumed_at IS NULL
    ORDER BY a.key_hmac
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100));
END;
$$;

CREATE OR REPLACE FUNCTION private.purge_personal_data_batch(p_run_id text, p_batch_size integer DEFAULT 100)
RETURNS TABLE (step_name text, rows_affected integer, step_complete boolean, keyed_hmac text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_step text;
    v_limit integer := GREATEST(1, LEAST(COALESCE(p_batch_size, 100), 200));
    v_count integer := 0;
    v_secret bytea;
    v_digest text;
    v_run_state text;
BEGIN
    IF p_run_id <> 'yum-overhaul-20260928' OR session_user <> 'purge_identity' THEN
        RAISE EXCEPTION 'fixed purge procedures require the exact run and dedicated purge_identity login';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM private.personal_data_write_freeze AS f
        WHERE f.singleton AND f.active_run_id = p_run_id
    ) THEN RAISE EXCEPTION 'write freeze is not active for the exact run'; END IF;
    SELECT state, key_secret INTO v_run_state, v_secret FROM private.personal_data_purge_runs WHERE run_id = p_run_id FOR UPDATE;
    IF v_run_state NOT IN ('SNAPSHOTTED', 'PURGING') OR v_secret IS NULL THEN RAISE EXCEPTION 'exact-run allowlists are not snapshotted'; END IF;
    IF NOT EXISTS (SELECT 1 FROM private.personal_data_purge_runs WHERE run_id = p_run_id AND tus_quiescence_verified) THEN
        RAISE EXCEPTION 'TUS upload quiescence is not proven; purge remains blocked';
    END IF;

    SELECT j.step_name INTO v_step
    FROM private.personal_data_write_freeze_step_journal AS j
    WHERE j.run_id = p_run_id AND j.status <> 'COMMITTED'
    ORDER BY j.step_name
    LIMIT 1;
    -- The journal uses explicit ordinal ordering so no caller can skip a phase.
    SELECT steps.step_name INTO v_step
    FROM (VALUES
        (1, 'review_media_detach'), (2, 'review_likes'), (3, 'menu_wishlists'),
        (4, 'reviews'), (5, 'review_media_assets'), (6, 'legacy_media_asset_identity'),
        (7, 'review_legacy_rights'), (8, 'consumed_media_verification_proofs'),
        (9, 'media_verification_rate_limits'), (10, 'media_verification_quotas'),
        (11, 'media_verification_leases'), (12, 'profiles'), (13, 'restaurant_owners'),
        (14, 'user_roles'), (15, 'legacy_user_identity'), (16, 'menu_media_attribution'),
        (17, 'auth_users')
    ) AS steps(step_order, step_name)
    JOIN private.personal_data_write_freeze_step_journal AS j ON j.step_name = steps.step_name AND j.run_id = p_run_id
    WHERE j.status <> 'COMMITTED'
    ORDER BY steps.step_order
    LIMIT 1;
    IF v_step IS NULL THEN
        UPDATE private.personal_data_purge_runs SET state = 'COMPLETE' WHERE run_id = p_run_id;
        RETURN QUERY SELECT 'COMPLETE'::text, 0, true, NULL::text;
        RETURN;
    END IF;
    UPDATE private.personal_data_purge_runs SET state = 'PURGING' WHERE run_id = p_run_id;
    UPDATE private.personal_data_write_freeze_step_journal
       SET status = 'STARTED', started_at = COALESCE(started_at, pg_catalog.clock_timestamp())
     WHERE run_id = p_run_id AND personal_data_write_freeze_step_journal.step_name = v_step;

    IF v_step = 'review_media_detach' THEN
        WITH selected AS (
            SELECT a.row_key
            FROM private.personal_data_purge_allowlist AS a
            JOIN public.media_assets AS asset ON asset.id::text = a.row_key
            WHERE a.run_id = p_run_id AND a.relation_name = 'public.media_assets'
              AND a.scope = 'REVIEW_MEDIA' AND a.consumed_at IS NULL
              AND asset.media_kind = 'REVIEW' AND asset.lifecycle_status <> 'DELETE_PENDING'
            ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED
        ), changed AS (
            UPDATE public.media_assets AS asset SET lifecycle_status = 'DELETE_PENDING'
            FROM selected s WHERE asset.id::text = s.row_key
            RETURNING asset.id
        ) SELECT count(*) INTO v_count FROM changed;
        WITH selected AS (
            SELECT a.row_key
            FROM private.personal_data_purge_allowlist AS a
            JOIN public.review_photos AS photo
              ON a.row_key = photo.review_id::text || ':' || photo.media_id::text
            WHERE a.run_id = p_run_id AND a.relation_name = 'public.review_photos'
              AND a.scope = 'ROW' AND a.consumed_at IS NULL
            ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED
        ), removed AS (
            DELETE FROM public.review_photos AS photo USING selected s
            WHERE s.row_key = photo.review_id::text || ':' || photo.media_id::text
            RETURNING photo.review_id, photo.media_id
        ), marked AS (
            UPDATE private.personal_data_purge_allowlist AS a
            SET consumed_at = pg_catalog.clock_timestamp()
            FROM removed d
            WHERE a.run_id = p_run_id AND a.relation_name = 'public.review_photos'
              AND a.row_key = d.review_id::text || ':' || d.media_id::text AND a.scope = 'ROW'
            RETURNING 1
        ) SELECT v_count + count(*) INTO v_count FROM marked;
        IF NOT EXISTS (
            SELECT 1 FROM public.media_assets AS asset JOIN private.personal_data_purge_allowlist AS a
              ON a.run_id = p_run_id AND a.relation_name = 'public.media_assets'
             AND a.row_key = asset.id::text AND a.scope = 'REVIEW_MEDIA'
            WHERE asset.media_kind = 'REVIEW' AND asset.lifecycle_status <> 'DELETE_PENDING'
        ) AND NOT EXISTS (
            SELECT 1 FROM public.review_photos AS photo JOIN private.personal_data_purge_allowlist AS a
              ON a.run_id = p_run_id AND a.relation_name = 'public.review_photos'
             AND a.row_key = photo.review_id::text || ':' || photo.media_id::text AND a.scope = 'ROW'
        ) THEN
            UPDATE private.personal_data_write_freeze_step_journal SET status = 'COMMITTED', committed_at = pg_catalog.clock_timestamp()
            WHERE run_id = p_run_id AND personal_data_write_freeze_step_journal.step_name = v_step;
        END IF;
    ELSIF v_step = 'menu_media_attribution' THEN
        WITH selected AS (
            SELECT a.row_key FROM private.personal_data_purge_allowlist AS a
            JOIN public.media_assets AS asset ON asset.id::text = a.row_key
            WHERE a.run_id = p_run_id AND a.relation_name = 'public.media_assets'
              AND a.scope = 'MENU_ATTRIBUTION' AND a.consumed_at IS NULL
              AND asset.media_kind = 'MENU' AND asset.uploaded_by IS NOT NULL
            ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED
        ), changed AS (
            UPDATE public.media_assets AS asset SET uploaded_by = NULL FROM selected s
            WHERE asset.id::text = s.row_key AND asset.media_kind = 'MENU' RETURNING asset.id
        ) SELECT count(*) INTO v_count FROM changed;
        WITH selected AS (
            SELECT a.row_key FROM private.personal_data_purge_allowlist AS a
            JOIN private.legacy_media_rights AS rights ON rights.legacy_media_id = a.row_key
            WHERE a.run_id = p_run_id AND a.relation_name = 'private.legacy_media_rights'
              AND a.scope = 'MENU_ATTRIBUTION' AND a.consumed_at IS NULL
              AND rights.rights_attested_legacy_user_id IS NOT NULL
            ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED
        ), changed AS (
            UPDATE private.legacy_media_rights AS rights SET rights_attested_legacy_user_id = NULL
            FROM selected s WHERE rights.legacy_media_id = s.row_key RETURNING rights.legacy_media_id
        ) SELECT v_count + count(*) INTO v_count FROM changed;
        UPDATE private.personal_data_purge_allowlist AS a SET consumed_at = pg_catalog.clock_timestamp()
        WHERE a.run_id = p_run_id AND a.scope = 'MENU_ATTRIBUTION' AND a.consumed_at IS NULL
          AND ((a.relation_name = 'public.media_assets' AND EXISTS (
                 SELECT 1 FROM public.media_assets AS asset WHERE asset.id::text = a.row_key AND asset.media_kind = 'MENU' AND asset.uploaded_by IS NULL))
            OR (a.relation_name = 'private.legacy_media_rights' AND EXISTS (
                 SELECT 1 FROM private.legacy_media_rights AS rights WHERE rights.legacy_media_id = a.row_key AND rights.rights_attested_legacy_user_id IS NULL)));
        IF NOT EXISTS (
            SELECT 1 FROM public.media_assets AS asset JOIN private.personal_data_purge_allowlist AS a
              ON a.run_id = p_run_id AND a.relation_name = 'public.media_assets' AND a.row_key = asset.id::text
             AND a.scope = 'MENU_ATTRIBUTION' WHERE asset.media_kind = 'MENU' AND asset.uploaded_by IS NOT NULL
        ) AND NOT EXISTS (
            SELECT 1 FROM private.legacy_media_rights AS rights JOIN private.personal_data_purge_allowlist AS a
              ON a.run_id = p_run_id AND a.relation_name = 'private.legacy_media_rights'
             AND a.row_key = rights.legacy_media_id AND a.scope = 'MENU_ATTRIBUTION'
            WHERE rights.rights_attested_legacy_user_id IS NOT NULL
        ) THEN
            UPDATE private.personal_data_write_freeze_step_journal SET status = 'COMMITTED', committed_at = pg_catalog.clock_timestamp()
            WHERE run_id = p_run_id AND personal_data_write_freeze_step_journal.step_name = v_step;
        END IF;
    ELSE
        IF v_step = 'auth_users' AND EXISTS (
            SELECT 1 FROM private.personal_data_purge_allowlist AS a
            WHERE a.run_id = p_run_id AND a.relation_name = 'storage.objects'
              AND a.scope = 'REVIEW_MEDIA' AND a.consumed_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Auth deletion waits until every REVIEW object is consumed through Storage API';
        END IF;
        -- Each branch is a fixed allowlisted relation and a fixed primary key.
        IF v_step = 'review_likes' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN public.review_likes t
                ON a.row_key = t.user_id::text || ':' || t.review_id::text WHERE a.run_id=p_run_id AND a.relation_name='public.review_likes' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM public.review_likes t USING picked p WHERE p.row_key=t.user_id::text || ':' || t.review_id::text RETURNING t.user_id, t.review_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='public.review_likes' AND a.row_key=g.user_id::text || ':' || g.review_id::text AND a.scope='ROW';
        ELSIF v_step = 'menu_wishlists' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN public.menu_wishlists t
                ON a.row_key = t.user_id::text || ':' || t.menu_id::text WHERE a.run_id=p_run_id AND a.relation_name='public.menu_wishlists' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM public.menu_wishlists t USING picked p WHERE p.row_key=t.user_id::text || ':' || t.menu_id::text RETURNING t.user_id, t.menu_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='public.menu_wishlists' AND a.row_key=g.user_id::text || ':' || g.menu_id::text AND a.scope='ROW';
        ELSIF v_step = 'reviews' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN public.reviews t
                ON a.row_key=t.id::text WHERE a.run_id=p_run_id AND a.relation_name='public.reviews' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM public.reviews t USING picked p WHERE p.row_key=t.id::text RETURNING t.id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='public.reviews' AND a.row_key=g.id::text AND a.scope='ROW';
        ELSIF v_step = 'review_media_assets' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN public.media_assets t
                ON a.row_key=t.id::text WHERE a.run_id=p_run_id AND a.relation_name='public.media_assets' AND a.scope='REVIEW_MEDIA' AND a.consumed_at IS NULL AND t.media_kind='REVIEW'
                AND NOT EXISTS (SELECT 1 FROM private.personal_data_purge_allowlist s WHERE s.run_id=p_run_id AND s.relation_name='storage.objects' AND s.row_key='yum-review-media:' || t.object_path AND s.consumed_at IS NULL)
                AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='yum-review-media' AND o.name=t.object_path)
                ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM public.media_assets t USING picked p WHERE p.row_key=t.id::text AND t.media_kind='REVIEW' RETURNING t.id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='public.media_assets' AND a.row_key=g.id::text AND a.scope='REVIEW_MEDIA';
        ELSIF v_step = 'legacy_media_asset_identity' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.legacy_media_asset_identity t
                ON a.row_key=t.legacy_media_id WHERE a.run_id=p_run_id AND a.relation_name='private.legacy_media_asset_identity' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.legacy_media_asset_identity t USING picked p WHERE p.row_key=t.legacy_media_id RETURNING t.legacy_media_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.legacy_media_asset_identity' AND a.row_key=g.legacy_media_id AND a.scope='ROW';
        ELSIF v_step = 'review_legacy_rights' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.legacy_media_rights t
                ON a.row_key=t.legacy_media_id WHERE a.run_id=p_run_id AND a.relation_name='private.legacy_media_rights' AND a.scope='REVIEW_RIGHTS' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.legacy_media_rights t USING picked p WHERE p.row_key=t.legacy_media_id RETURNING t.legacy_media_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.legacy_media_rights' AND a.row_key=g.legacy_media_id AND a.scope='REVIEW_RIGHTS';
        ELSIF v_step = 'consumed_media_verification_proofs' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.consumed_media_verification_proofs t
                ON a.row_key=t.nonce::text WHERE a.run_id=p_run_id AND a.relation_name='private.consumed_media_verification_proofs' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.consumed_media_verification_proofs t USING picked p WHERE p.row_key=t.nonce::text RETURNING t.nonce)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.consumed_media_verification_proofs' AND a.row_key=g.nonce::text AND a.scope='ROW';
        ELSIF v_step = 'media_verification_rate_limits' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.media_verification_rate_limits t
                ON a.row_key=t.user_id::text WHERE a.run_id=p_run_id AND a.relation_name='private.media_verification_rate_limits' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.media_verification_rate_limits t USING picked p WHERE p.row_key=t.user_id::text RETURNING t.user_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.media_verification_rate_limits' AND a.row_key=g.user_id::text AND a.scope='ROW';
        ELSIF v_step = 'media_verification_quotas' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.media_verification_quotas t
                ON a.row_key=t.user_id::text WHERE a.run_id=p_run_id AND a.relation_name='private.media_verification_quotas' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.media_verification_quotas t USING picked p WHERE p.row_key=t.user_id::text RETURNING t.user_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.media_verification_quotas' AND a.row_key=g.user_id::text AND a.scope='ROW';
        ELSIF v_step = 'media_verification_leases' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.media_verification_leases t
                ON a.row_key=t.lease_digest WHERE a.run_id=p_run_id AND a.relation_name='private.media_verification_leases' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.media_verification_leases t USING picked p WHERE p.row_key=t.lease_digest RETURNING t.lease_digest)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.media_verification_leases' AND a.row_key=g.lease_digest AND a.scope='ROW';
        ELSIF v_step = 'profiles' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN public.profiles t
                ON a.row_key=t.user_id::text WHERE a.run_id=p_run_id AND a.relation_name='public.profiles' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM public.profiles t USING picked p WHERE p.row_key=t.user_id::text RETURNING t.user_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='public.profiles' AND a.row_key=g.user_id::text AND a.scope='ROW';
        ELSIF v_step = 'restaurant_owners' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.restaurant_owners t
                ON a.row_key=t.user_id::text || ':' || t.restaurant_id::text WHERE a.run_id=p_run_id AND a.relation_name='private.restaurant_owners' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.restaurant_owners t USING picked p WHERE p.row_key=t.user_id::text || ':' || t.restaurant_id::text RETURNING t.user_id, t.restaurant_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.restaurant_owners' AND a.row_key=g.user_id::text || ':' || g.restaurant_id::text AND a.scope='ROW';
        ELSIF v_step = 'user_roles' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.user_roles t
                ON a.row_key=t.user_id::text || ':' || t.role_code WHERE a.run_id=p_run_id AND a.relation_name='private.user_roles' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.user_roles t USING picked p WHERE p.row_key=t.user_id::text || ':' || t.role_code RETURNING t.user_id, t.role_code)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.user_roles' AND a.row_key=g.user_id::text || ':' || g.role_code AND a.scope='ROW';
        ELSIF v_step = 'legacy_user_identity' THEN
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN private.legacy_user_identity t
                ON a.row_key=t.legacy_user_id::text WHERE a.run_id=p_run_id AND a.relation_name='private.legacy_user_identity' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM private.legacy_user_identity t USING picked p WHERE p.row_key=t.legacy_user_id::text RETURNING t.legacy_user_id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='private.legacy_user_identity' AND a.row_key=g.legacy_user_id::text AND a.scope='ROW';
        ELSIF v_step = 'auth_users' THEN
            IF EXISTS (
                SELECT 1 FROM private.personal_data_purge_allowlist a
                WHERE a.run_id=p_run_id AND a.relation_name <> 'auth.users'
                  AND a.scope IN ('ROW', 'REVIEW_MEDIA', 'REVIEW_RIGHTS') AND a.consumed_at IS NULL
            ) THEN RAISE EXCEPTION 'Auth deletion is last and all personal references must be removed first'; END IF;
            WITH picked AS (SELECT a.row_key FROM private.personal_data_purge_allowlist a JOIN auth.users t
                ON a.row_key=t.id::text WHERE a.run_id=p_run_id AND a.relation_name='auth.users' AND a.scope='ROW' AND a.consumed_at IS NULL ORDER BY a.key_hmac LIMIT v_limit FOR UPDATE OF a SKIP LOCKED), gone AS (
                DELETE FROM auth.users t USING picked p WHERE p.row_key=t.id::text RETURNING t.id)
                UPDATE private.personal_data_purge_allowlist a SET consumed_at=pg_catalog.clock_timestamp() FROM gone g WHERE a.run_id=p_run_id AND a.relation_name='auth.users' AND a.row_key=g.id::text AND a.scope='ROW';
        END IF;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        IF v_count = 0 THEN
            IF EXISTS (
                SELECT 1 FROM private.personal_data_purge_allowlist AS a
                WHERE a.run_id = p_run_id
                  AND ((v_step = 'review_likes' AND a.relation_name = 'public.review_likes')
                    OR (v_step = 'menu_wishlists' AND a.relation_name = 'public.menu_wishlists')
                    OR (v_step = 'reviews' AND a.relation_name = 'public.reviews')
                    OR (v_step = 'review_media_assets' AND a.relation_name = 'public.media_assets' AND a.scope = 'REVIEW_MEDIA')
                    OR (v_step = 'legacy_media_asset_identity' AND a.relation_name = 'private.legacy_media_asset_identity')
                    OR (v_step = 'review_legacy_rights' AND a.relation_name = 'private.legacy_media_rights' AND a.scope = 'REVIEW_RIGHTS')
                    OR (v_step = 'consumed_media_verification_proofs' AND a.relation_name = 'private.consumed_media_verification_proofs')
                    OR (v_step = 'media_verification_rate_limits' AND a.relation_name = 'private.media_verification_rate_limits')
                    OR (v_step = 'media_verification_quotas' AND a.relation_name = 'private.media_verification_quotas')
                    OR (v_step = 'media_verification_leases' AND a.relation_name = 'private.media_verification_leases')
                    OR (v_step = 'profiles' AND a.relation_name = 'public.profiles')
                    OR (v_step = 'restaurant_owners' AND a.relation_name = 'private.restaurant_owners')
                    OR (v_step = 'user_roles' AND a.relation_name = 'private.user_roles')
                    OR (v_step = 'legacy_user_identity' AND a.relation_name = 'private.legacy_user_identity')
                    OR (v_step = 'auth_users' AND a.relation_name = 'auth.users'))
                  AND a.consumed_at IS NULL
            ) THEN
                RAISE EXCEPTION 'allowlisted rows remain; an unexpected reference or ordering issue blocks purge';
            END IF;
            UPDATE private.personal_data_write_freeze_step_journal
               SET status = 'COMMITTED', committed_at = pg_catalog.clock_timestamp()
             WHERE run_id = p_run_id AND personal_data_write_freeze_step_journal.step_name = v_step;
        END IF;
    END IF;

    SELECT pg_catalog.encode(extensions.hmac(
        pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(a.key_hmac, '' ORDER BY a.key_hmac), ''), 'UTF8'),
        v_secret, 'sha256'), 'hex')
      INTO v_digest
    FROM private.personal_data_purge_allowlist AS a
    WHERE a.run_id = p_run_id AND a.relation_name IN (
        CASE v_step
            WHEN 'review_media_detach' THEN 'public.review_photos'
            WHEN 'review_likes' THEN 'public.review_likes'
            WHEN 'menu_wishlists' THEN 'public.menu_wishlists'
            WHEN 'reviews' THEN 'public.reviews'
            WHEN 'review_media_assets' THEN 'public.media_assets'
            WHEN 'legacy_media_asset_identity' THEN 'private.legacy_media_asset_identity'
            WHEN 'review_legacy_rights' THEN 'private.legacy_media_rights'
            WHEN 'consumed_media_verification_proofs' THEN 'private.consumed_media_verification_proofs'
            WHEN 'media_verification_rate_limits' THEN 'private.media_verification_rate_limits'
            WHEN 'media_verification_quotas' THEN 'private.media_verification_quotas'
            WHEN 'media_verification_leases' THEN 'private.media_verification_leases'
            WHEN 'profiles' THEN 'public.profiles'
            WHEN 'restaurant_owners' THEN 'private.restaurant_owners'
            WHEN 'user_roles' THEN 'private.user_roles'
            WHEN 'legacy_user_identity' THEN 'private.legacy_user_identity'
            WHEN 'menu_media_attribution' THEN 'public.media_assets'
            WHEN 'auth_users' THEN 'auth.users'
            ELSE 'public.review_photos'
        END
    );
    UPDATE private.personal_data_write_freeze_step_journal
       SET rows_affected = rows_affected + v_count,
           keyed_hmac = v_digest
     WHERE run_id = p_run_id AND personal_data_write_freeze_step_journal.step_name = v_step;
    RETURN QUERY SELECT v_step, v_count,
        (SELECT status = 'COMMITTED' FROM private.personal_data_write_freeze_step_journal WHERE run_id=p_run_id AND personal_data_write_freeze_step_journal.step_name=v_step),
        v_digest;
END;
$$;

CREATE OR REPLACE FUNCTION private.verify_personal_data_catalog_preserved(p_run_id text)
RETURNS TABLE (preserved boolean, restaurant_count bigint, menu_count bigint, menu_asset_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_run private.personal_data_purge_runs%ROWTYPE;
    v_secret bytea;
    v_restaurant_count bigint;
    v_restaurant_hmac text;
    v_menu_count bigint;
    v_menu_hmac text;
    v_asset_count bigint;
    v_asset_hmac text;
BEGIN
    IF p_run_id <> 'yum-overhaul-20260928' THEN RAISE EXCEPTION 'exact run mismatch'; END IF;
    SELECT * INTO v_run FROM private.personal_data_purge_runs WHERE run_id = p_run_id;
    v_secret := v_run.key_secret;
    SELECT count(*), pg_catalog.encode(extensions.hmac(
        pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(r)::text, '' ORDER BY r.id), ''), 'UTF8'), v_secret, 'sha256'), 'hex')
      INTO v_restaurant_count, v_restaurant_hmac FROM public.restaurants r;
    SELECT count(*), pg_catalog.encode(extensions.hmac(
        pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(m)::text, '' ORDER BY m.id), ''), 'UTF8'), v_secret, 'sha256'), 'hex')
      INTO v_menu_count, v_menu_hmac FROM public.menus m;
    SELECT count(*), pg_catalog.encode(extensions.hmac(
        pg_catalog.convert_to(COALESCE(pg_catalog.string_agg((pg_catalog.to_jsonb(a) - 'uploaded_by')::text, '' ORDER BY a.id), ''), 'UTF8'), v_secret, 'sha256'), 'hex')
      INTO v_asset_count, v_asset_hmac FROM public.media_assets a WHERE a.media_kind = 'MENU';
    RETURN QUERY SELECT v_run.catalog_restaurant_count = v_restaurant_count
        AND v_run.catalog_restaurant_hmac = v_restaurant_hmac
        AND v_run.catalog_menu_count = v_menu_count
        AND v_run.catalog_menu_hmac = v_menu_hmac
        AND v_run.menu_asset_count = v_asset_count
        AND v_run.menu_asset_hmac = v_asset_hmac,
        v_restaurant_count, v_menu_count, v_asset_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.release_personal_data_write_freeze(p_run_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_preserved boolean;
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928' THEN
        RAISE EXCEPTION 'operator procedure requires the exact approved run';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(7123341, 2809);
    IF NOT EXISTS (SELECT 1 FROM private.personal_data_purge_runs WHERE run_id=p_run_id AND state='COMPLETE')
       OR EXISTS (SELECT 1 FROM private.personal_data_purge_allowlist WHERE run_id=p_run_id AND consumed_at IS NULL) THEN
        RAISE EXCEPTION 'freeze release requires every exact-run checkpoint and allowlist to be complete';
    END IF;
    SELECT preserved INTO v_preserved FROM private.verify_personal_data_catalog_preserved(p_run_id);
    IF NOT COALESCE(v_preserved, false) THEN RAISE EXCEPTION 'retained catalog or MENU media digest changed'; END IF;
    UPDATE private.personal_data_write_freeze SET active_run_id=NULL, frozen_at=NULL WHERE singleton AND active_run_id=p_run_id;
    RETURN true;
END;
$$;

ALTER FUNCTION private.activate_personal_data_write_freeze(text) OWNER TO purge_guard_owner;
ALTER FUNCTION private.bind_personal_data_purge_storage_context() OWNER TO purge_guard_owner;
ALTER FUNCTION private.attest_personal_data_tus_quiescence(text, text) OWNER TO purge_guard_owner;
ALTER FUNCTION private.snapshot_personal_data_purge_allowlists(text) OWNER TO purge_guard_owner;
ALTER FUNCTION private.next_review_storage_paths(text, integer) OWNER TO purge_guard_owner;
ALTER FUNCTION private.purge_personal_data_batch(text, integer) OWNER TO purge_guard_owner;
ALTER FUNCTION private.verify_personal_data_catalog_preserved(text) OWNER TO purge_guard_owner;
ALTER FUNCTION private.release_personal_data_write_freeze(text) OWNER TO purge_guard_owner;

REVOKE ALL ON FUNCTION private.activate_personal_data_write_freeze(text) FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.bind_personal_data_purge_storage_context() FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.attest_personal_data_tus_quiescence(text, text) FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.snapshot_personal_data_purge_allowlists(text) FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.next_review_storage_paths(text, integer) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION private.purge_personal_data_batch(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.verify_personal_data_catalog_preserved(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.release_personal_data_write_freeze(text) FROM PUBLIC, anon, authenticated, service_role, purge_identity;

GRANT EXECUTE ON FUNCTION private.activate_personal_data_write_freeze(text) TO postgres;
GRANT EXECUTE ON FUNCTION private.bind_personal_data_purge_storage_context() TO postgres;
GRANT EXECUTE ON FUNCTION private.attest_personal_data_tus_quiescence(text, text) TO postgres;
GRANT EXECUTE ON FUNCTION private.snapshot_personal_data_purge_allowlists(text) TO postgres;
GRANT EXECUTE ON FUNCTION private.next_review_storage_paths(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.purge_personal_data_batch(text, integer) TO purge_identity;
GRANT EXECUTE ON FUNCTION private.verify_personal_data_catalog_preserved(text) TO postgres;
GRANT EXECUTE ON FUNCTION private.release_personal_data_write_freeze(text) TO postgres;

-- Procedure owner has only the fixed relation and control-table privileges its
-- fixed procedures need. The LOGIN identities have no direct table grants.
GRANT SELECT, DELETE ON auth.users TO purge_guard_owner;
GRANT SELECT, DELETE ON public.profiles, public.reviews, public.review_photos,
    public.review_likes, public.menu_wishlists TO purge_guard_owner;
GRANT SELECT, UPDATE, DELETE ON public.media_assets TO purge_guard_owner;
GRANT SELECT, DELETE ON private.legacy_user_identity, private.user_roles,
    private.restaurant_owners, private.legacy_media_asset_identity,
    private.consumed_media_verification_proofs, private.media_verification_rate_limits,
    private.media_verification_quotas, private.media_verification_leases TO purge_guard_owner;
GRANT SELECT, UPDATE, DELETE ON private.legacy_media_rights TO purge_guard_owner;
GRANT SELECT ON public.restaurants, public.menus, storage.objects TO purge_guard_owner;
GRANT UPDATE ON private.personal_data_write_freeze, private.personal_data_purge_runs,
    private.personal_data_purge_allowlist, private.personal_data_write_freeze_step_journal TO purge_guard_owner;
GRANT INSERT ON private.personal_data_purge_runs, private.personal_data_purge_allowlist,
    private.personal_data_write_freeze_step_journal, private.personal_data_storage_principal_observations TO purge_guard_owner;

-- The procedure owner intentionally has no BYPASSRLS privilege. These policies
-- grant its fixed SECURITY DEFINER procedures exact-run reads and only the
-- row/scope pairs captured by the immutable active-run allowlist.
CREATE OR REPLACE FUNCTION private.purge_guard_run_is_active()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM private.personal_data_write_freeze AS f
        JOIN private.personal_data_purge_runs AS r ON r.run_id = f.active_run_id
        WHERE f.singleton AND f.active_run_id = 'yum-overhaul-20260928'
          AND r.state IN ('FROZEN', 'SNAPSHOTTED', 'PURGING', 'COMPLETE')
    )
$$;

CREATE OR REPLACE FUNCTION private.purge_guard_row_is_allowlisted(
    p_relation text, p_row_key text, p_scopes text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT private.purge_guard_run_is_active()
       AND EXISTS (
           SELECT 1 FROM private.personal_data_purge_allowlist AS a
           WHERE a.run_id = 'yum-overhaul-20260928'
             AND a.relation_name = p_relation AND a.row_key = p_row_key
             AND a.scope = ANY(p_scopes) AND a.consumed_at IS NULL
       )
$$;

ALTER FUNCTION private.purge_guard_run_is_active() OWNER TO purge_guard_owner;
ALTER FUNCTION private.purge_guard_row_is_allowlisted(text, text, text[]) OWNER TO purge_guard_owner;
REVOKE CREATE ON SCHEMA private, public FROM purge_guard_owner;
DO $schema_create_check$
BEGIN
    IF has_schema_privilege('purge_guard_owner', 'private', 'CREATE')
       OR has_schema_privilege('purge_guard_owner', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'purge_guard_owner retained temporary schema CREATE';
    END IF;
END;
$schema_create_check$;
REVOKE ALL ON FUNCTION private.purge_guard_run_is_active() FROM PUBLIC, anon, authenticated, service_role, purge_identity;
REVOKE ALL ON FUNCTION private.purge_guard_row_is_allowlisted(text, text, text[]) FROM PUBLIC, anon, authenticated, service_role, purge_identity;
GRANT EXECUTE ON FUNCTION private.purge_guard_run_is_active() TO purge_guard_owner;
GRANT EXECUTE ON FUNCTION private.purge_guard_row_is_allowlisted(text, text, text[]) TO purge_guard_owner;

DO $purge_owner_policies$
DECLARE
    relation_name text;
    row_key_expression text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'public.profiles', 'public.reviews', 'public.review_photos', 'public.review_likes',
        'public.menu_wishlists', 'public.media_assets', 'private.legacy_user_identity',
        'private.user_roles', 'private.restaurant_owners', 'private.legacy_media_rights',
        'private.legacy_media_asset_identity', 'private.consumed_media_verification_proofs',
        'private.media_verification_rate_limits', 'private.media_verification_quotas',
        'private.media_verification_leases'
    ] LOOP
        row_key_expression := CASE relation_name
            WHEN 'public.profiles' THEN 'user_id::text'
            WHEN 'public.reviews' THEN 'id::text'
            WHEN 'public.review_photos' THEN $$review_id::text || ':' || media_id::text$$
            WHEN 'public.review_likes' THEN $$user_id::text || ':' || review_id::text$$
            WHEN 'public.menu_wishlists' THEN $$user_id::text || ':' || menu_id::text$$
            WHEN 'public.media_assets' THEN 'id::text'
            WHEN 'private.legacy_user_identity' THEN 'legacy_user_id::text'
            WHEN 'private.user_roles' THEN $$user_id::text || ':' || role_code$$
            WHEN 'private.restaurant_owners' THEN $$user_id::text || ':' || restaurant_id::text$$
            WHEN 'private.legacy_media_rights' THEN 'legacy_media_id'
            WHEN 'private.legacy_media_asset_identity' THEN 'legacy_media_id'
            WHEN 'private.consumed_media_verification_proofs' THEN 'nonce::text'
            WHEN 'private.media_verification_rate_limits' THEN 'user_id::text'
            WHEN 'private.media_verification_quotas' THEN 'user_id::text'
            WHEN 'private.media_verification_leases' THEN 'lease_digest'
            ELSE NULL
        END;
        EXECUTE pg_catalog.format('DROP POLICY IF EXISTS purge_guard_exact_run_read ON %s', relation_name);
        EXECUTE pg_catalog.format('CREATE POLICY purge_guard_exact_run_read ON %s FOR SELECT TO purge_guard_owner USING (private.purge_guard_run_is_active())', relation_name);
        EXECUTE pg_catalog.format('DROP POLICY IF EXISTS purge_guard_exact_run_delete ON %s', relation_name);
        IF relation_name = 'private.legacy_media_rights' THEN
            EXECUTE pg_catalog.format(
                'CREATE POLICY purge_guard_exact_run_delete ON %s FOR DELETE TO purge_guard_owner USING (private.purge_guard_row_is_allowlisted(%L, %s, ARRAY[''REVIEW_RIGHTS'']))',
                relation_name, relation_name, row_key_expression);
        ELSE
            EXECUTE pg_catalog.format(
                'CREATE POLICY purge_guard_exact_run_delete ON %s FOR DELETE TO purge_guard_owner USING (private.purge_guard_row_is_allowlisted(%L, %s, ARRAY[''ROW'',''REVIEW_MEDIA'']))',
                relation_name, relation_name, row_key_expression);
        END IF;
    END LOOP;

    DROP POLICY IF EXISTS purge_guard_exact_run_menu_rights_update ON private.legacy_media_rights;
    CREATE POLICY purge_guard_exact_run_menu_rights_update ON private.legacy_media_rights
        FOR UPDATE TO purge_guard_owner
        USING (private.purge_guard_row_is_allowlisted('private.legacy_media_rights', legacy_media_id,
            ARRAY['MENU_ATTRIBUTION']))
        WITH CHECK (private.purge_guard_run_is_active());

    DROP POLICY IF EXISTS purge_guard_exact_run_media_update ON public.media_assets;
    CREATE POLICY purge_guard_exact_run_media_update ON public.media_assets
        FOR UPDATE TO purge_guard_owner
        USING (private.purge_guard_row_is_allowlisted('public.media_assets', id::text,
            ARRAY['REVIEW_MEDIA', 'MENU_ATTRIBUTION']))
        WITH CHECK (private.purge_guard_run_is_active());

    DROP POLICY IF EXISTS purge_guard_exact_run_catalog_read ON public.restaurants;
    CREATE POLICY purge_guard_exact_run_catalog_read ON public.restaurants
        FOR SELECT TO purge_guard_owner USING (private.purge_guard_run_is_active());
    DROP POLICY IF EXISTS purge_guard_exact_run_menu_read ON public.menus;
    CREATE POLICY purge_guard_exact_run_menu_read ON public.menus
        FOR SELECT TO purge_guard_owner USING (private.purge_guard_run_is_active());
    DROP POLICY IF EXISTS purge_guard_exact_run_storage_read ON storage.objects;
    CREATE POLICY purge_guard_exact_run_storage_read ON storage.objects
        FOR SELECT TO purge_guard_owner
        USING (bucket_id = 'yum-review-media' AND private.purge_guard_run_is_active());
END;
$purge_owner_policies$;
