-- Bound expensive media verification across accounts and prove server/Vault key
-- parity before a Storage object is downloaded.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE private.media_verification_quotas (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    window_started_at timestamptz NOT NULL,
    attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 6)
);
REVOKE ALL ON TABLE private.media_verification_quotas FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.media_verification_leases (
    lease_digest text PRIMARY KEY CHECK (lease_digest ~ '^[0-9a-f]{64}$'),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE INDEX media_verification_leases_expiry_idx
    ON private.media_verification_leases (expires_at);
REVOKE ALL ON TABLE private.media_verification_leases FROM PUBLIC, anon, authenticated, service_role;

-- The result reveals only whether this caller's pending upload uses the same
-- HMAC key as Vault. Key bytes and Vault values never leave the function.
CREATE FUNCTION public.verify_media_validation_key(
    p_media_id uuid,
    p_key_id text,
    p_challenge text,
    p_signature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_secret text;
    v_key bytea;
    v_message text;
BEGIN
    IF v_user_id IS NULL OR p_media_id IS NULL
       OR p_key_id IS NULL OR p_key_id !~ '^[A-Za-z0-9._-]{1,64}$'
       OR p_challenge IS NULL OR p_challenge !~ '^[0-9a-f]{64}$'
       OR p_signature IS NULL OR p_signature !~ '^[0-9a-f]{64}$' THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.media_assets AS a
        WHERE a.id = p_media_id
          AND a.uploaded_by = v_user_id
          AND a.lifecycle_status = 'PENDING'
          AND private.can_upload_media_path(a.object_path)
    ) THEN
        RETURN false;
    END IF;

    SELECT s.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets AS s
    WHERE s.name = 'yum-review-media-validation:' || p_key_id;
    IF v_secret IS NULL THEN
        RETURN false;
    END IF;
    v_key := decode(v_secret, 'base64');
    IF octet_length(v_key) < 32
       OR replace(encode(v_key, 'base64'), E'\n', '') <> v_secret THEN
        RETURN false;
    END IF;

    v_message := 'yum-review-media-key-preflight-v1' || E'\n'
        || p_media_id::text || E'\n' || p_key_id || E'\n' || p_challenge;
    RETURN encode(extensions.hmac(convert_to(v_message, 'UTF8'), v_key, 'sha256'), 'hex') = p_signature;
EXCEPTION WHEN OTHERS THEN
    -- Do not expose Vault permissions, values, or parsing errors to the caller.
    RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_media_validation_key(uuid, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_media_validation_key(uuid, text, text, text)
    TO authenticated;

-- One transaction-scoped advisory lock serializes lease cleanup, quota updates,
-- and global slot assignment across application processes.
CREATE FUNCTION public.claim_media_verification_slot(p_media_id uuid)
RETURNS TABLE (allowed boolean, lease_token text, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_now timestamptz;
    v_window_started_at timestamptz;
    v_attempts integer;
    v_active_count bigint;
    v_earliest_expiry timestamptz;
    v_lease_token text;
BEGIN
    IF v_user_id IS NULL OR p_media_id IS NULL THEN
        RETURN;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(19860926, 1730);
    v_now := clock_timestamp();

    IF NOT EXISTS (
        SELECT 1
        FROM public.media_assets AS a
        WHERE a.id = p_media_id
          AND a.uploaded_by = v_user_id
          AND a.lifecycle_status = 'PENDING'
          AND private.can_upload_media_path(a.object_path)
    ) THEN
        RETURN;
    END IF;

    DELETE FROM private.media_verification_leases AS l
    WHERE l.expires_at <= v_now;
    DELETE FROM private.media_verification_quotas AS q
    WHERE q.window_started_at < v_now - interval '1 day';

    INSERT INTO private.media_verification_quotas AS current_quota (user_id, window_started_at, attempts)
    VALUES (v_user_id, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE
    SET window_started_at = CASE
            WHEN current_quota.window_started_at <= v_now - interval '60 seconds' THEN v_now
            ELSE current_quota.window_started_at
        END,
        attempts = CASE
            WHEN current_quota.window_started_at <= v_now - interval '60 seconds' THEN 1
            ELSE least(6, current_quota.attempts + 1)
        END
    RETURNING attempts, window_started_at INTO v_attempts, v_window_started_at;

    IF v_attempts > 5 THEN
        RETURN QUERY SELECT false, NULL::text,
            greatest(1, least(60, ceil(extract(epoch FROM (v_window_started_at + interval '60 seconds' - v_now)))::integer));
        RETURN;
    END IF;

    SELECT count(*), min(l.expires_at)
    INTO v_active_count, v_earliest_expiry
    FROM private.media_verification_leases AS l
    WHERE l.expires_at > v_now;
    IF v_active_count >= 2 THEN
        RETURN QUERY SELECT false, NULL::text,
            greatest(1, least(90, ceil(extract(epoch FROM (v_earliest_expiry - v_now)))::integer));
        RETURN;
    END IF;

    v_lease_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO private.media_verification_leases (lease_digest, user_id, media_id, expires_at)
    VALUES (
        encode(extensions.digest(convert_to(v_lease_token, 'UTF8'), 'sha256'), 'hex'),
        v_user_id,
        p_media_id,
        v_now + interval '90 seconds'
    );
    RETURN QUERY SELECT true, v_lease_token, NULL::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_media_verification_slot(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_media_verification_slot(uuid)
    TO authenticated;

CREATE FUNCTION public.release_media_verification_slot(p_media_id uuid, p_lease_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_deleted integer;
BEGIN
    IF v_user_id IS NULL OR p_media_id IS NULL
       OR p_lease_token IS NULL OR p_lease_token !~ '^[0-9a-f]{64}$' THEN
        RETURN false;
    END IF;

    DELETE FROM private.media_verification_leases AS l
    WHERE l.lease_digest = encode(extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'), 'hex')
      AND l.user_id = v_user_id
      AND l.media_id = p_media_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.release_media_verification_slot(uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_media_verification_slot(uuid, text)
    TO authenticated;
