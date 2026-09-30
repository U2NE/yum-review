-- Disabled-by-default, database-enforced write freeze for personal rows and the
-- retained legacy catalog. Activation serializes with admitted DML transactions.
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'purge_guard_owner') THEN
        EXECUTE 'CREATE ROLE purge_guard_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'purge_identity') THEN
        EXECUTE 'CREATE ROLE purge_identity LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'purge_guard_owner'
          AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolcanlogin)
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = 'purge_identity'
          AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR NOT rolcanlogin)
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members m
        JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
        JOIN pg_catalog.pg_roles u ON u.oid = m.member
        WHERE r.rolname IN ('purge_guard_owner', 'purge_identity')
           OR u.rolname IN ('purge_guard_owner', 'purge_identity')
    ) THEN
        RAISE EXCEPTION 'procedure owner must be NOLOGIN, purge_identity must be LOGIN, and neither may have memberships';
    END IF;
END;
$roles$;

CREATE TABLE private.personal_data_write_freeze (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    active_run_id text,
    frozen_at timestamptz,
    CHECK ((active_run_id IS NULL AND frozen_at IS NULL)
        OR (active_run_id = 'yum-overhaul-20260928' AND frozen_at IS NOT NULL))
);
INSERT INTO private.personal_data_write_freeze(singleton, active_run_id, frozen_at)
VALUES (true, NULL, NULL);

CREATE TABLE private.personal_data_purge_runs (
    run_id text PRIMARY KEY CHECK (run_id = 'yum-overhaul-20260928'),
    state text NOT NULL CHECK (state IN ('FROZEN', 'SNAPSHOTTED', 'PURGING', 'COMPLETE')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    key_secret bytea NOT NULL CHECK (octet_length(key_secret) = 32),
    media_inventory_verified boolean NOT NULL DEFAULT false,
    media_inventory_digest text CHECK (media_inventory_digest IS NULL OR media_inventory_digest ~ '^[0-9a-f]{64}$')
);
CREATE TABLE private.legacy_personal_data_media_volumes (
    run_id text NOT NULL REFERENCES private.personal_data_purge_runs(run_id),
    volume_id text NOT NULL CHECK (volume_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    started_inventory_hmac text CHECK (started_inventory_hmac IS NULL OR started_inventory_hmac ~ '^[0-9a-f]{64}$'),
    start_attested_at timestamptz,
    committed_at timestamptz,
    PRIMARY KEY (run_id, volume_id),
    CHECK ((started_inventory_hmac IS NULL AND start_attested_at IS NULL)
        OR (started_inventory_hmac IS NOT NULL AND start_attested_at IS NOT NULL))
);
CREATE TABLE private.personal_data_purge_allowlist (
    run_id text NOT NULL REFERENCES private.personal_data_purge_runs(run_id),
    relation_name text NOT NULL CHECK (relation_name IN
        ('app_user', 'restaurant_owner', 'review', 'review_photo', 'media_asset')),
    row_key text NOT NULL,
    scope text NOT NULL CHECK (scope IN ('ROW', 'MENU_ATTRIBUTION')),
    key_hmac text NOT NULL CHECK (key_hmac ~ '^[0-9a-f]{64}$'),
    consumed_at timestamptz,
    PRIMARY KEY (run_id, relation_name, row_key, scope)
);
CREATE TABLE private.personal_data_write_freeze_step_journal (
    run_id text NOT NULL REFERENCES private.personal_data_purge_runs(run_id),
    step_name text NOT NULL,
    status text NOT NULL CHECK (status IN ('PENDING', 'STARTED', 'COMMITTED')),
    rows_affected bigint NOT NULL DEFAULT 0 CHECK (rows_affected >= 0),
    keyed_hmac text,
    started_at timestamptz,
    committed_at timestamptz,
    PRIMARY KEY (run_id, step_name),
    CHECK (keyed_hmac IS NULL OR keyed_hmac ~ '^[0-9a-f]{64}$')
);

-- The media command needs the original file-set manifest after an interrupted
-- delete. Store only counts and keyed opaque digests; never persist file names,
-- paths, or row identifiers in this checkpoint.
CREATE TABLE private.legacy_review_media_purge_journal (
    run_id text NOT NULL,
    volume_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('STARTED', 'COMMITTED')),
    started_review_file_count bigint NOT NULL CHECK (started_review_file_count >= 0),
    started_temporary_file_count bigint NOT NULL CHECK (started_temporary_file_count >= 0),
    started_menu_file_count bigint NOT NULL CHECK (started_menu_file_count >= 0),
    started_review_hmacs text[] NOT NULL,
    started_temporary_hmacs text[] NOT NULL,
    started_menu_hmacs text[] NOT NULL,
    started_inventory_hmac text NOT NULL CHECK (started_inventory_hmac ~ '^[0-9a-f]{64}$'),
    started_menu_hmac text NOT NULL CHECK (started_menu_hmac ~ '^[0-9a-f]{64}$'),
    started_at timestamptz NOT NULL,
    committed_review_file_count bigint,
    committed_temporary_file_count bigint,
    committed_menu_file_count bigint,
    committed_inventory_hmac text,
    committed_menu_hmac text,
    committed_at timestamptz,
    CONSTRAINT ck_legacy_media_hmac_cardinality CHECK (
        pg_catalog.cardinality(started_review_hmacs) = started_review_file_count
        AND pg_catalog.cardinality(started_temporary_hmacs) = started_temporary_file_count
        AND pg_catalog.cardinality(started_menu_hmacs) = started_menu_file_count
    ),
    CONSTRAINT ck_legacy_media_checkpoint_state CHECK (
        (status = 'STARTED'
            AND committed_review_file_count IS NULL
            AND committed_temporary_file_count IS NULL
            AND committed_menu_file_count IS NULL
            AND committed_inventory_hmac IS NULL
            AND committed_menu_hmac IS NULL
            AND committed_at IS NULL)
        OR (status = 'COMMITTED'
            AND committed_review_file_count = started_review_file_count
            AND committed_temporary_file_count = started_temporary_file_count
            AND committed_menu_file_count = started_menu_file_count
            AND committed_inventory_hmac IS NOT NULL
            AND committed_inventory_hmac ~ '^[0-9a-f]{64}$'
            AND committed_menu_hmac IS NOT NULL
            AND committed_menu_hmac = started_menu_hmac
            AND committed_at IS NOT NULL)
    ),
    PRIMARY KEY (run_id, volume_id),
    FOREIGN KEY (run_id, volume_id)
        REFERENCES private.legacy_personal_data_media_volumes(run_id, volume_id)
);

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO purge_guard_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    private.personal_data_write_freeze,
    private.personal_data_purge_runs,
    private.personal_data_purge_allowlist,
    private.personal_data_write_freeze_step_journal,
    private.legacy_personal_data_media_volumes,
    private.legacy_review_media_purge_journal TO purge_guard_owner;
ALTER TABLE private.personal_data_write_freeze OWNER TO purge_guard_owner;
ALTER TABLE private.personal_data_purge_runs OWNER TO purge_guard_owner;
ALTER TABLE private.personal_data_purge_allowlist OWNER TO purge_guard_owner;
ALTER TABLE private.personal_data_write_freeze_step_journal OWNER TO purge_guard_owner;
ALTER TABLE private.legacy_personal_data_media_volumes OWNER TO purge_guard_owner;
ALTER TABLE private.legacy_review_media_purge_journal OWNER TO purge_guard_owner;

CREATE OR REPLACE FUNCTION private.legacy_personal_write_is_frozen()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT COALESCE((SELECT active_run_id IS NOT NULL
        FROM private.personal_data_write_freeze WHERE singleton), false)
$$;

CREATE OR REPLACE FUNCTION public.personal_data_write_is_frozen()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT private.legacy_personal_write_is_frozen() $$;

CREATE OR REPLACE FUNCTION public.legacy_personal_data_purge_run_is_active(p_run_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT p_run_id = 'yum-overhaul-20260928'
       AND EXISTS (SELECT 1 FROM private.personal_data_write_freeze
                   WHERE singleton AND active_run_id = p_run_id)
$$;

CREATE OR REPLACE FUNCTION public.legacy_personal_data_media_inventory_verified(p_run_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT p_run_id = 'yum-overhaul-20260928'
       AND EXISTS (SELECT 1 FROM private.personal_data_purge_runs r
                   WHERE r.run_id = p_run_id AND r.media_inventory_verified)
$$;

CREATE OR REPLACE FUNCTION public.legacy_personal_data_digest(p_run_id text, p_manifest_sha256 text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(p_manifest_sha256, 'UTF8'), r.key_secret, 'sha256'), 'hex')
    FROM private.personal_data_purge_runs r
    WHERE p_run_id = 'yum-overhaul-20260928' AND r.run_id = p_run_id
      AND p_manifest_sha256 ~ '^[0-9a-f]{64}$'
      AND EXISTS (SELECT 1 FROM private.personal_data_write_freeze f
                  WHERE f.singleton AND f.active_run_id = p_run_id)
$$;

CREATE OR REPLACE FUNCTION public.legacy_personal_data_media_item_hmacs(
    p_run_id text, p_review_digests text[], p_temporary_digests text[], p_menu_digests text[])
RETURNS TABLE (review_hmacs text[], temporary_hmacs text[], menu_hmacs text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_secret bytea;
BEGIN
    IF session_user NOT IN ('purge_identity', 'postgres') OR p_run_id <> 'yum-overhaul-20260928'
       OR p_review_digests IS NULL OR p_temporary_digests IS NULL OR p_menu_digests IS NULL THEN
        RAISE EXCEPTION 'legacy media manifest requires the dedicated exact-run purge identity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_review_digests) AS item(value) WHERE value !~ '^[0-9a-f]{64}$')
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_temporary_digests) AS item(value) WHERE value !~ '^[0-9a-f]{64}$')
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_menu_digests) AS item(value) WHERE value !~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'legacy media item digest is malformed';
    END IF;
    SELECT r.key_secret INTO v_secret
    FROM private.personal_data_purge_runs AS r
    JOIN private.personal_data_write_freeze AS f ON f.singleton AND f.active_run_id = p_run_id
    WHERE r.run_id = p_run_id AND r.media_inventory_verified
      AND r.state IN ('FROZEN', 'SNAPSHOTTED', 'PURGING');
    IF v_secret IS NULL THEN RAISE EXCEPTION 'the exact-run frozen media inventory is not verified'; END IF;

    RETURN QUERY SELECT
        ARRAY(SELECT pg_catalog.encode(extensions.hmac(
                    pg_catalog.convert_to('review:' || item.value, 'UTF8'), v_secret, 'sha256'), 'hex')
              FROM pg_catalog.unnest(p_review_digests) AS item(value) ORDER BY item.value),
        ARRAY(SELECT pg_catalog.encode(extensions.hmac(
                    pg_catalog.convert_to('temporary:' || item.value, 'UTF8'), v_secret, 'sha256'), 'hex')
              FROM pg_catalog.unnest(p_temporary_digests) AS item(value) ORDER BY item.value),
        ARRAY(SELECT pg_catalog.encode(extensions.hmac(
                    pg_catalog.convert_to('menu:' || item.value, 'UTF8'), v_secret, 'sha256'), 'hex')
              FROM pg_catalog.unnest(p_menu_digests) AS item(value) ORDER BY item.value);
END;
$$;

CREATE OR REPLACE FUNCTION private.legacy_media_manifest_hmac(
    p_run_id text, p_review_hmacs text[], p_temporary_hmacs text[], p_menu_hmacs text[])
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(
        'review:' || pg_catalog.array_to_string(
            ARRAY(SELECT value FROM pg_catalog.unnest(COALESCE(p_review_hmacs, ARRAY[]::text[])) AS items(value) ORDER BY value), E'\n')
        || E'\ntemporary:' || pg_catalog.array_to_string(
            ARRAY(SELECT value FROM pg_catalog.unnest(COALESCE(p_temporary_hmacs, ARRAY[]::text[])) AS items(value) ORDER BY value), E'\n')
        || E'\nmenu:' || pg_catalog.array_to_string(
            ARRAY(SELECT value FROM pg_catalog.unnest(COALESCE(p_menu_hmacs, ARRAY[]::text[])) AS items(value) ORDER BY value), E'\n'),
        'UTF8'), r.key_secret, 'sha256'), 'hex')
    FROM private.personal_data_purge_runs AS r
    WHERE r.run_id = p_run_id AND p_run_id = 'yum-overhaul-20260928'
      AND EXISTS (SELECT 1 FROM private.personal_data_write_freeze AS f
                  WHERE f.singleton AND f.active_run_id = p_run_id)
$$;

CREATE OR REPLACE FUNCTION public.begin_legacy_review_media_purge(
    p_run_id text,
    p_volume_id text,
    p_review_hmacs text[],
    p_temporary_hmacs text[],
    p_menu_hmacs text[])
RETURNS TABLE (
    status text,
    started_review_file_count bigint,
    started_temporary_file_count bigint,
    started_menu_file_count bigint,
    started_review_hmacs text[],
    started_temporary_hmacs text[],
    started_menu_hmacs text[],
    started_inventory_hmac text,
    started_menu_hmac text,
    start_attested_at timestamptz,
    committed_review_file_count bigint,
    committed_temporary_file_count bigint,
    committed_menu_file_count bigint,
    committed_inventory_hmac text,
    committed_menu_hmac text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_review_hmacs text[];
    v_temporary_hmacs text[];
    v_menu_hmacs text[];
BEGIN
    IF session_user <> 'purge_identity' OR p_run_id <> 'yum-overhaul-20260928'
       OR p_volume_id IS NULL OR p_volume_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
       OR p_review_hmacs IS NULL OR p_temporary_hmacs IS NULL OR p_menu_hmacs IS NULL THEN
        RAISE EXCEPTION 'legacy media checkpoint requires the dedicated exact-run purge identity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_review_hmacs) AS item(value) WHERE value !~ '^[0-9a-f]{64}$')
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_temporary_hmacs) AS item(value) WHERE value !~ '^[0-9a-f]{64}$')
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_menu_hmacs) AS item(value) WHERE value !~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'legacy media checkpoint contains a malformed opaque digest';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM private.personal_data_write_freeze AS f
        JOIN private.personal_data_purge_runs AS r ON r.run_id = p_run_id
        WHERE f.singleton AND f.active_run_id = p_run_id AND r.media_inventory_verified
          AND r.state IN ('FROZEN', 'SNAPSHOTTED', 'PURGING')
    ) THEN
        RAISE EXCEPTION 'the exact-run freeze and all-volume media inventory are required';
    END IF;
    v_review_hmacs := ARRAY(SELECT value FROM pg_catalog.unnest(p_review_hmacs) AS items(value) ORDER BY value);
    v_temporary_hmacs := ARRAY(SELECT value FROM pg_catalog.unnest(p_temporary_hmacs) AS items(value) ORDER BY value);
    v_menu_hmacs := ARRAY(SELECT value FROM pg_catalog.unnest(p_menu_hmacs) AS items(value) ORDER BY value);

    INSERT INTO private.legacy_review_media_purge_journal (
        run_id, volume_id, status, started_review_file_count, started_temporary_file_count, started_menu_file_count,
        started_review_hmacs, started_temporary_hmacs, started_menu_hmacs,
        started_inventory_hmac, started_menu_hmac, started_at)
    VALUES (
        p_run_id, p_volume_id, 'STARTED', pg_catalog.cardinality(v_review_hmacs),
        pg_catalog.cardinality(v_temporary_hmacs), pg_catalog.cardinality(v_menu_hmacs),
        v_review_hmacs, v_temporary_hmacs, v_menu_hmacs,
        private.legacy_media_manifest_hmac(p_run_id, v_review_hmacs, v_temporary_hmacs, v_menu_hmacs),
        private.legacy_media_manifest_hmac(p_run_id, ARRAY[]::text[], ARRAY[]::text[], v_menu_hmacs),
        pg_catalog.clock_timestamp())
    ON CONFLICT (run_id, volume_id) DO NOTHING;

    RETURN QUERY SELECT j.status, j.started_review_file_count, j.started_temporary_file_count,
        j.started_menu_file_count, j.started_review_hmacs, j.started_temporary_hmacs, j.started_menu_hmacs,
        j.started_inventory_hmac, j.started_menu_hmac, v.start_attested_at, j.committed_review_file_count,
        j.committed_temporary_file_count, j.committed_menu_file_count,
        j.committed_inventory_hmac, j.committed_menu_hmac
    FROM private.legacy_review_media_purge_journal AS j
    JOIN private.legacy_personal_data_media_volumes AS v USING (run_id, volume_id)
    WHERE j.run_id = p_run_id AND j.volume_id = p_volume_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.attest_legacy_review_media_purge_start(
    p_run_id text, p_volume_id text, p_review_digests text[],
    p_temporary_digests text[], p_menu_digests text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_started_hmac text;
    v_review_hmacs text[];
    v_temporary_hmacs text[];
    v_menu_hmacs text[];
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928'
       OR p_volume_id IS NULL OR p_volume_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
       OR p_review_digests IS NULL OR p_temporary_digests IS NULL OR p_menu_digests IS NULL THEN
        RAISE EXCEPTION 'only the trusted operator may attest an exact-run volume inventory';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM private.personal_data_write_freeze AS f
        JOIN private.personal_data_purge_runs AS r ON r.run_id = p_run_id
        JOIN private.legacy_personal_data_media_volumes AS v ON v.run_id = r.run_id AND v.volume_id = p_volume_id
        WHERE f.singleton AND f.active_run_id = p_run_id AND r.media_inventory_verified
          AND r.state = 'FROZEN'
    ) THEN
        RAISE EXCEPTION 'the exact-run frozen volume set is not registered';
    END IF;
    SELECT review_hmacs, temporary_hmacs, menu_hmacs
    INTO v_review_hmacs, v_temporary_hmacs, v_menu_hmacs
    FROM public.legacy_personal_data_media_item_hmacs(
        p_run_id, p_review_digests, p_temporary_digests, p_menu_digests);
    SELECT j.started_inventory_hmac INTO v_started_hmac
    FROM private.legacy_review_media_purge_journal AS j
    WHERE j.run_id = p_run_id AND j.volume_id = p_volume_id AND j.status = 'STARTED'
      AND j.started_review_hmacs = v_review_hmacs
      AND j.started_temporary_hmacs = v_temporary_hmacs
      AND j.started_menu_hmacs = v_menu_hmacs
    FOR UPDATE;
    IF v_started_hmac IS NULL THEN
        RAISE EXCEPTION 'trusted filesystem rescan does not match its immutable STARTED checkpoint';
    END IF;
    UPDATE private.legacy_personal_data_media_volumes
    SET started_inventory_hmac = v_started_hmac,
        start_attested_at = COALESCE(start_attested_at, pg_catalog.clock_timestamp())
    WHERE run_id = p_run_id AND volume_id = p_volume_id
      AND (started_inventory_hmac IS NULL OR started_inventory_hmac = v_started_hmac);
    IF NOT FOUND THEN RAISE EXCEPTION 'volume STARTED attestation changed'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.legacy_personal_data_media_inventory_all_volumes_attested(p_run_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
    SELECT p_run_id = 'yum-overhaul-20260928'
       AND EXISTS (SELECT 1 FROM private.personal_data_purge_runs r
                   WHERE r.run_id = p_run_id AND r.media_inventory_verified)
       AND EXISTS (SELECT 1 FROM private.legacy_personal_data_media_volumes v WHERE v.run_id = p_run_id)
       AND NOT EXISTS (SELECT 1 FROM private.legacy_personal_data_media_volumes v
                       WHERE v.run_id = p_run_id AND v.start_attested_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.commit_legacy_review_media_purge(
    p_run_id text, p_volume_id text, p_review_digests text[],
    p_temporary_digests text[], p_menu_digests text[])
RETURNS TABLE (
    status text,
    committed_review_file_count bigint,
    committed_temporary_file_count bigint,
    committed_menu_file_count bigint,
    committed_inventory_hmac text,
    committed_menu_hmac text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_journal private.legacy_review_media_purge_journal%ROWTYPE;
    v_review_hmacs text[];
    v_temporary_hmacs text[];
    v_menu_hmacs text[];
    v_menu_digest text;
    v_inventory_digest text;
    v_started_inventory_hmac text;
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928'
       OR p_volume_id IS NULL OR p_volume_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
       OR p_review_digests IS NULL OR p_temporary_digests IS NULL OR p_menu_digests IS NULL THEN
        RAISE EXCEPTION 'only the trusted operator may commit an empty exact-run volume rescan';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM private.personal_data_write_freeze AS f
        JOIN private.personal_data_purge_runs AS r ON r.run_id = p_run_id
        WHERE f.singleton AND f.active_run_id = p_run_id AND r.media_inventory_verified
          AND r.state IN ('FROZEN', 'SNAPSHOTTED', 'PURGING', 'COMPLETE')
    ) THEN
        RAISE EXCEPTION 'the exact-run freeze and all-volume media inventory are required';
    END IF;
    SELECT j.* INTO v_journal FROM private.legacy_review_media_purge_journal AS j
    JOIN private.legacy_personal_data_media_volumes AS v USING (run_id, volume_id)
    WHERE j.run_id = p_run_id AND j.volume_id = p_volume_id AND v.start_attested_at IS NOT NULL
    FOR UPDATE OF j, v;
    IF NOT FOUND THEN RAISE EXCEPTION 'trusted STARTED volume attestation is missing'; END IF;
    SELECT started_inventory_hmac INTO v_started_inventory_hmac
    FROM private.legacy_personal_data_media_volumes
    WHERE run_id = p_run_id AND volume_id = p_volume_id;
    IF v_started_inventory_hmac IS NULL OR v_started_inventory_hmac <> v_journal.started_inventory_hmac THEN
        RAISE EXCEPTION 'trusted STARTED volume attestation changed';
    END IF;

    SELECT review_hmacs, temporary_hmacs, menu_hmacs
    INTO v_review_hmacs, v_temporary_hmacs, v_menu_hmacs
    FROM public.legacy_personal_data_media_item_hmacs(
        p_run_id, p_review_digests, p_temporary_digests, p_menu_digests);
    IF pg_catalog.cardinality(v_review_hmacs) <> 0
       OR pg_catalog.cardinality(v_temporary_hmacs) <> 0 THEN
        RAISE EXCEPTION 'trusted filesystem rescan still contains review or temporary media';
    END IF;
    IF pg_catalog.cardinality(v_menu_hmacs) <> v_journal.started_menu_file_count
       OR v_menu_hmacs <> v_journal.started_menu_hmacs THEN
        RAISE EXCEPTION 'retained MENU files changed; media purge cannot commit';
    END IF;
    v_menu_digest := private.legacy_media_manifest_hmac(p_run_id, ARRAY[]::text[], ARRAY[]::text[], v_menu_hmacs);
    v_inventory_digest := private.legacy_media_manifest_hmac(p_run_id, ARRAY[]::text[], ARRAY[]::text[], v_menu_hmacs);

    IF v_journal.status = 'COMMITTED' THEN
        IF v_journal.committed_menu_hmac <> v_menu_digest THEN
            RAISE EXCEPTION 'committed MENU evidence changed';
        END IF;
        UPDATE private.legacy_personal_data_media_volumes
        SET committed_at = COALESCE(committed_at, pg_catalog.clock_timestamp())
        WHERE run_id = p_run_id AND volume_id = p_volume_id AND start_attested_at IS NOT NULL;
        RETURN QUERY SELECT j.status, j.committed_review_file_count, j.committed_temporary_file_count,
            j.committed_menu_file_count, j.committed_inventory_hmac, j.committed_menu_hmac
        FROM private.legacy_review_media_purge_journal AS j
        WHERE j.run_id = p_run_id AND j.volume_id = p_volume_id;
        RETURN;
    END IF;

    UPDATE private.legacy_review_media_purge_journal AS j
    SET status = 'COMMITTED',
        committed_review_file_count = j.started_review_file_count,
        committed_temporary_file_count = j.started_temporary_file_count,
        committed_menu_file_count = j.started_menu_file_count,
        committed_inventory_hmac = v_inventory_digest,
        committed_menu_hmac = v_menu_digest,
        committed_at = pg_catalog.clock_timestamp()
    WHERE j.run_id = p_run_id AND j.volume_id = p_volume_id AND j.status = 'STARTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'legacy media STARTED checkpoint changed before commit'; END IF;
    UPDATE private.legacy_personal_data_media_volumes
    SET committed_at = COALESCE(committed_at, pg_catalog.clock_timestamp())
    WHERE run_id = p_run_id AND volume_id = p_volume_id AND start_attested_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'expected media volume attestation disappeared'; END IF;
    RETURN QUERY SELECT j.status, j.committed_review_file_count, j.committed_temporary_file_count,
        j.committed_menu_file_count, j.committed_inventory_hmac, j.committed_menu_hmac
    FROM private.legacy_review_media_purge_journal AS j WHERE j.run_id = p_run_id AND j.volume_id = p_volume_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.attest_legacy_personal_data_media_inventory(
    p_run_id text, p_volume_ids text[], p_inventory_digest text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928'
       OR p_inventory_digest IS NULL OR p_inventory_digest !~ '^[0-9a-f]{64}$'
       OR p_volume_ids IS NULL OR pg_catalog.cardinality(p_volume_ids) = 0
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_volume_ids) AS item(value)
                  WHERE value IS NULL OR value !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
       OR (SELECT count(DISTINCT value) FROM pg_catalog.unnest(p_volume_ids) AS item(value))
            <> pg_catalog.cardinality(p_volume_ids) THEN
        RAISE EXCEPTION 'only the trusted operator may attest the exact-run media inventory';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM private.personal_data_write_freeze
                   WHERE singleton AND active_run_id = p_run_id) THEN
        RAISE EXCEPTION 'the exact-run write freeze must be active first';
    END IF;
    IF EXISTS (SELECT 1 FROM private.legacy_personal_data_media_volumes WHERE run_id = p_run_id)
       OR EXISTS (SELECT 1 FROM private.legacy_review_media_purge_journal WHERE run_id = p_run_id) THEN
        RAISE EXCEPTION 'media volume inventory is immutable after its first attestation';
    END IF;
    INSERT INTO private.legacy_personal_data_media_volumes(run_id, volume_id)
    SELECT p_run_id, value FROM pg_catalog.unnest(p_volume_ids) AS item(value);
    UPDATE private.personal_data_purge_runs
    SET media_inventory_verified = true, media_inventory_digest = p_inventory_digest
    WHERE run_id = p_run_id AND state = 'FROZEN';
    IF NOT FOUND THEN RAISE EXCEPTION 'active exact-run inventory checkpoint is missing'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_legacy_personal_data_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_run_id text;
    v_relation text := TG_TABLE_NAME;
    v_row_key text;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(7123341, 2810);
    SELECT active_run_id INTO v_run_id
    FROM private.personal_data_write_freeze WHERE singleton;
    IF v_run_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF v_relation IN ('restaurant', 'menu') THEN
        RAISE EXCEPTION 'personal data write freeze is active' USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_row_key := CASE v_relation
            WHEN 'app_user' THEN to_jsonb(OLD) ->> 'id'
            WHEN 'restaurant_owner' THEN (to_jsonb(OLD) ->> 'user_id') || ':' || (to_jsonb(OLD) ->> 'restaurant_id')
            WHEN 'review' THEN to_jsonb(OLD) ->> 'id'
            WHEN 'review_photo' THEN (to_jsonb(OLD) ->> 'review_id') || ':' || (to_jsonb(OLD) ->> 'media_id')
            WHEN 'media_asset' THEN to_jsonb(OLD) ->> 'media_id'
            ELSE NULL END;
    ELSE
        v_row_key := CASE v_relation
            WHEN 'app_user' THEN to_jsonb(NEW) ->> 'id'
            WHEN 'restaurant_owner' THEN (to_jsonb(NEW) ->> 'user_id') || ':' || (to_jsonb(NEW) ->> 'restaurant_id')
            WHEN 'review' THEN to_jsonb(NEW) ->> 'id'
            WHEN 'review_photo' THEN (to_jsonb(NEW) ->> 'review_id') || ':' || (to_jsonb(NEW) ->> 'media_id')
            WHEN 'media_asset' THEN to_jsonb(NEW) ->> 'media_id'
            ELSE NULL END;
    END IF;

    IF TG_OP = 'UPDATE' AND v_relation = 'media_asset'
       AND session_user = 'purge_identity'
       AND OLD.storage_key LIKE 'menu-%'
       AND NEW.uploaded_by_user_id IS NULL
       AND NEW.rights_attested_by_user_id IS NULL
       AND (to_jsonb(NEW) - ARRAY['uploaded_by_user_id', 'rights_attested_by_user_id'])
           = (to_jsonb(OLD) - ARRAY['uploaded_by_user_id', 'rights_attested_by_user_id'])
       AND EXISTS (
           SELECT 1 FROM private.personal_data_purge_allowlist a
           WHERE a.run_id = v_run_id AND a.relation_name = 'media_asset'
             AND a.row_key = v_row_key AND a.scope = 'MENU_ATTRIBUTION'
             AND a.consumed_at IS NULL
       ) THEN
        UPDATE private.personal_data_purge_allowlist a SET consumed_at = clock_timestamp()
        WHERE a.run_id = v_run_id AND a.relation_name = 'media_asset'
          AND a.row_key = v_row_key AND a.scope = 'MENU_ATTRIBUTION' AND a.consumed_at IS NULL;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' AND session_user = 'purge_identity'
       AND EXISTS (
           SELECT 1 FROM private.personal_data_purge_allowlist a
           WHERE a.run_id = v_run_id AND a.relation_name = v_relation
             AND a.row_key = v_row_key AND a.scope = 'ROW' AND a.consumed_at IS NULL
       ) THEN
        UPDATE private.personal_data_purge_allowlist a SET consumed_at = clock_timestamp()
        WHERE a.run_id = v_run_id AND a.relation_name = v_relation
          AND a.row_key = v_row_key AND a.scope = 'ROW' AND a.consumed_at IS NULL;
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'personal data write freeze is active' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_legacy_personal_data_truncate()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(7123341, 2810);
    IF private.legacy_personal_write_is_frozen() THEN
        RAISE EXCEPTION 'personal data write freeze blocks TRUNCATE' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.activate_legacy_personal_data_write_freeze(p_run_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928' THEN
        RAISE EXCEPTION 'only the trusted project-owner operator may activate this exact run';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(7123341, 2810);
    IF EXISTS (SELECT 1 FROM private.personal_data_write_freeze WHERE singleton AND active_run_id IS NOT NULL) THEN
        RAISE EXCEPTION 'another personal-data freeze run is active';
    END IF;
    INSERT INTO private.personal_data_purge_runs(run_id, state, key_secret)
    VALUES (p_run_id, 'FROZEN', extensions.gen_random_bytes(32))
    ON CONFLICT (run_id) DO NOTHING;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'the exact-run purge checkpoint already exists; resume forward instead of resetting its key or journal';
    END IF;
    DELETE FROM private.personal_data_purge_allowlist WHERE run_id = p_run_id;
    DELETE FROM private.personal_data_write_freeze_step_journal WHERE run_id = p_run_id;
    UPDATE private.personal_data_write_freeze
    SET active_run_id = p_run_id, frozen_at = clock_timestamp() WHERE singleton;
END;
$$;

CREATE OR REPLACE FUNCTION private.release_legacy_personal_data_write_freeze(p_run_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
    v_target_count integer;
BEGIN
    IF session_user <> 'postgres' OR p_run_id <> 'yum-overhaul-20260928' THEN
        RAISE EXCEPTION 'only the trusted project-owner operator may release this exact run';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(7123341, 2810);
    IF NOT EXISTS (SELECT 1 FROM private.personal_data_write_freeze
                   WHERE singleton AND active_run_id = p_run_id) THEN
        RAISE EXCEPTION 'the exact-run legacy write freeze is not active';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM private.personal_data_purge_runs
                   WHERE run_id = p_run_id AND state = 'COMPLETE') THEN
        RAISE EXCEPTION 'legacy personal-data purge has not completed';
    END IF;
    SELECT count(*) INTO v_target_count
    FROM private.personal_data_purge_journal AS j
    WHERE j.run_id = p_run_id AND j.status = 'COMMITTED'
      AND j.remaining_rows = 0 AND j.remaining_objects = 0
      AND j.retained_menu_path_hmac IS NOT NULL AND j.retained_menu_bytes_hmac IS NOT NULL
      AND j.target IN ('legacy-review-media', 'legacy-db');
    IF v_target_count <> 2 OR EXISTS (
        SELECT 1 FROM (VALUES ('legacy-review-media'), ('legacy-db')) AS targets(target)
        WHERE NOT EXISTS (SELECT 1 FROM private.personal_data_purge_journal AS j
                          WHERE j.run_id = p_run_id AND j.target = targets.target AND j.status = 'COMMITTED')
    ) THEN
        RAISE EXCEPTION 'legacy review-media and database checkpoints must both be committed';
    END IF;
    IF EXISTS (SELECT 1 FROM private.personal_data_purge_allowlist AS a
               WHERE a.run_id = p_run_id AND a.consumed_at IS NULL) THEN
        RAISE EXCEPTION 'legacy purge allowlist still contains unconsumed entries';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM private.legacy_personal_data_media_volumes AS v WHERE v.run_id = p_run_id)
       OR EXISTS (
           SELECT 1 FROM private.legacy_personal_data_media_volumes AS v
           LEFT JOIN private.legacy_review_media_purge_journal AS j
             ON j.run_id = v.run_id AND j.volume_id = v.volume_id
           WHERE v.run_id = p_run_id
             AND (v.start_attested_at IS NULL OR v.committed_at IS NULL
                  OR j.status IS DISTINCT FROM 'COMMITTED')
       ) OR EXISTS (
           SELECT 1 FROM private.legacy_review_media_purge_journal AS j
           LEFT JOIN private.legacy_personal_data_media_volumes AS v
             ON v.run_id = j.run_id AND v.volume_id = j.volume_id
           WHERE j.run_id = p_run_id AND v.volume_id IS NULL
       ) THEN
        RAISE EXCEPTION 'every enumerated legacy media volume must have trusted STARTED and COMMITTED evidence';
    END IF;
    IF EXISTS (SELECT 1 FROM private.personal_data_write_freeze_step_journal AS j
               WHERE j.run_id = p_run_id AND j.status <> 'COMMITTED') THEN
        RAISE EXCEPTION 'legacy freeze step journal contains an incomplete checkpoint';
    END IF;

    UPDATE private.personal_data_write_freeze
    SET active_run_id = NULL, frozen_at = NULL
    WHERE singleton AND active_run_id = p_run_id;
END;
$$;

ALTER FUNCTION private.legacy_personal_write_is_frozen() OWNER TO purge_guard_owner;
ALTER FUNCTION public.personal_data_write_is_frozen() OWNER TO purge_guard_owner;
ALTER FUNCTION public.legacy_personal_data_purge_run_is_active(text) OWNER TO purge_guard_owner;
ALTER FUNCTION public.legacy_personal_data_media_inventory_verified(text) OWNER TO purge_guard_owner;
ALTER FUNCTION public.legacy_personal_data_digest(text, text) OWNER TO purge_guard_owner;
ALTER FUNCTION public.legacy_personal_data_media_item_hmacs(text, text[], text[], text[]) OWNER TO purge_guard_owner;
ALTER FUNCTION private.legacy_media_manifest_hmac(text, text[], text[], text[]) OWNER TO purge_guard_owner;
ALTER FUNCTION public.begin_legacy_review_media_purge(text, text, text[], text[], text[]) OWNER TO purge_guard_owner;
ALTER FUNCTION private.attest_legacy_review_media_purge_start(text, text, text[], text[], text[]) OWNER TO purge_guard_owner;
ALTER FUNCTION public.legacy_personal_data_media_inventory_all_volumes_attested(text) OWNER TO purge_guard_owner;
ALTER FUNCTION public.commit_legacy_review_media_purge(text, text, text[], text[], text[]) OWNER TO purge_guard_owner;
ALTER FUNCTION private.attest_legacy_personal_data_media_inventory(text, text[], text) OWNER TO purge_guard_owner;
ALTER FUNCTION private.guard_legacy_personal_data_write() OWNER TO purge_guard_owner;
ALTER FUNCTION private.guard_legacy_personal_data_truncate() OWNER TO purge_guard_owner;
ALTER FUNCTION private.activate_legacy_personal_data_write_freeze(text) OWNER TO purge_guard_owner;
ALTER FUNCTION private.release_legacy_personal_data_write_freeze(text) OWNER TO purge_guard_owner;
REVOKE ALL ON FUNCTION private.legacy_personal_write_is_frozen() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.personal_data_write_is_frozen() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legacy_personal_data_purge_run_is_active(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legacy_personal_data_media_inventory_verified(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legacy_personal_data_digest(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legacy_personal_data_media_item_hmacs(text, text[], text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.legacy_media_manifest_hmac(text, text[], text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_legacy_review_media_purge(text, text, text[], text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.attest_legacy_review_media_purge_start(text, text, text[], text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legacy_personal_data_media_inventory_all_volumes_attested(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_legacy_review_media_purge(text, text, text[], text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.attest_legacy_personal_data_media_inventory(text, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.activate_legacy_personal_data_write_freeze(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.release_legacy_personal_data_write_freeze(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.personal_data_write_is_frozen() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.legacy_personal_data_purge_run_is_active(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.legacy_personal_data_media_inventory_verified(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.legacy_personal_data_media_inventory_all_volumes_attested(text) TO purge_identity;
GRANT EXECUTE ON FUNCTION public.legacy_personal_data_digest(text, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.legacy_personal_data_media_item_hmacs(text, text[], text[], text[]) TO purge_identity;
GRANT EXECUTE ON FUNCTION public.legacy_personal_data_media_item_hmacs(text, text[], text[], text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.begin_legacy_review_media_purge(text, text, text[], text[], text[]) TO purge_identity;
GRANT EXECUTE ON FUNCTION private.attest_legacy_review_media_purge_start(text, text, text[], text[], text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.commit_legacy_review_media_purge(text, text, text[], text[], text[]) TO postgres;
GRANT EXECUTE ON FUNCTION private.attest_legacy_personal_data_media_inventory(text, text[], text) TO postgres;
GRANT EXECUTE ON FUNCTION private.activate_legacy_personal_data_write_freeze(text) TO postgres;
GRANT EXECUTE ON FUNCTION private.release_legacy_personal_data_write_freeze(text) TO postgres;

DO $guards$
DECLARE
    relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'app_user', 'restaurant_owner', 'review', 'review_photo', 'media_asset', 'restaurant', 'menu'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_personal_data_freeze ON %I', relation_name);
        EXECUTE format('CREATE TRIGGER trg_personal_data_freeze BEFORE INSERT OR UPDATE OR DELETE ON %I '
            'FOR EACH ROW EXECUTE FUNCTION private.guard_legacy_personal_data_write()', relation_name);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_personal_data_freeze_truncate ON %I', relation_name);
        EXECUTE format('CREATE TRIGGER trg_personal_data_freeze_truncate BEFORE TRUNCATE ON %I '
            'FOR EACH STATEMENT EXECUTE FUNCTION private.guard_legacy_personal_data_truncate()', relation_name);
    END LOOP;
END;
$guards$;
