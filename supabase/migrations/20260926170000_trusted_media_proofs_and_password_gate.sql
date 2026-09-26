-- Require a one-use server attestation before any pending media becomes public.
-- The HMAC secret itself is provisioned in Supabase Vault, never in a migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS private.consumed_media_verification_proofs (
    nonce uuid PRIMARY KEY,
    media_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
    proof_sha256 text NOT NULL UNIQUE,
    consumed_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
REVOKE ALL ON TABLE private.consumed_media_verification_proofs FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.activate_media_upload(uuid);

CREATE FUNCTION public.activate_media_upload(
    p_media_id uuid,
    p_proof_payload text,
    p_proof_signature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_asset public.media_assets%ROWTYPE;
    v_proof jsonb;
    v_secret text;
    v_key bytea;
    v_verified_at timestamptz;
    v_object_bytes bigint;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_media_id IS NULL OR p_proof_payload IS NULL OR length(p_proof_payload) > 2048
       OR p_proof_signature IS NULL OR p_proof_signature !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'valid media verification proof required' USING ERRCODE = '42501';
    END IF;

    BEGIN
        v_proof := p_proof_payload::jsonb;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'invalid media verification proof' USING ERRCODE = '42501';
    END;
    IF jsonb_typeof(v_proof) IS DISTINCT FROM 'object'
       OR v_proof->>'version' IS DISTINCT FROM '1'
       OR v_proof->>'mediaId' IS NULL
       OR v_proof->>'keyId' IS NULL OR v_proof->>'keyId' !~ '^[A-Za-z0-9._-]{1,64}$'
       OR v_proof->>'nonce' IS NULL OR v_proof->>'nonce' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR v_proof->>'sha256' IS NULL OR v_proof->>'sha256' !~ '^[0-9a-f]{64}$'
       OR v_proof->>'contentType' IS NULL OR v_proof->>'contentType' NOT IN ('image/jpeg', 'image/png', 'image/webp')
       OR v_proof->>'originalBytes' IS NULL OR v_proof->>'originalBytes' !~ '^[1-9][0-9]{0,8}$'
       OR v_proof->>'storedBytes' IS NULL OR v_proof->>'storedBytes' !~ '^[1-9][0-9]{0,8}$'
       OR v_proof->>'objectPath' IS NULL
       OR v_proof->>'verifiedAt' IS NULL THEN
        RAISE EXCEPTION 'invalid media verification proof fields' USING ERRCODE = '42501';
    END IF;

    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'yum-review-media-validation:' || (v_proof->>'keyId');
    IF v_secret IS NULL THEN
        RAISE EXCEPTION 'media verification key is not configured' USING ERRCODE = '42501';
    END IF;
    BEGIN
        v_key := decode(v_secret, 'base64');
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'media verification key is invalid' USING ERRCODE = '42501';
    END;
    IF octet_length(v_key) < 32 OR replace(encode(v_key, 'base64'), E'\n', '') <> v_secret
       OR encode(extensions.hmac(convert_to(p_proof_payload, 'UTF8'), v_key, 'sha256'), 'hex') <> p_proof_signature THEN
        RAISE EXCEPTION 'media verification signature is invalid' USING ERRCODE = '42501';
    END IF;

    BEGIN
        v_verified_at := (v_proof->>'verifiedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'media verification timestamp is invalid' USING ERRCODE = '42501';
    END;
    IF v_verified_at < pg_catalog.now() - interval '60 seconds'
       OR v_verified_at > pg_catalog.now() + interval '10 seconds'
       OR (v_proof->>'mediaId')::uuid <> p_media_id THEN
        RAISE EXCEPTION 'media verification proof has expired or does not match' USING ERRCODE = '42501';
    END IF;

    SELECT a.* INTO v_asset
    FROM public.media_assets AS a
    WHERE a.id = p_media_id AND a.uploaded_by = v_user_id AND a.lifecycle_status = 'PENDING'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'upload intent not found' USING ERRCODE = '42501';
    END IF;

    IF v_proof->>'objectPath' <> v_asset.object_path
       OR v_proof->>'contentType' <> v_asset.content_type
       OR (v_proof->>'originalBytes')::bigint <> v_asset.original_bytes
       OR (v_proof->>'storedBytes')::bigint <> v_asset.stored_bytes
       OR (v_proof->>'storedBytes')::bigint > 99999999
       OR NOT private.can_upload_media_path(v_asset.object_path) THEN
        RAISE EXCEPTION 'media verification proof does not match the upload' USING ERRCODE = '42501';
    END IF;

    SELECT (o.metadata->>'size')::bigint INTO v_object_bytes
    FROM storage.objects AS o
    WHERE o.bucket_id = 'yum-review-media'
      AND o.name = v_asset.object_path
      AND o.metadata->>'size' ~ '^[1-9][0-9]{0,8}$';
    IF NOT FOUND OR v_object_bytes <> (v_proof->>'storedBytes')::bigint THEN
        RAISE EXCEPTION 'stored media object size does not match its proof' USING ERRCODE = '42501';
    END IF;

    INSERT INTO private.consumed_media_verification_proofs (nonce, media_id, proof_sha256)
    VALUES (
        (v_proof->>'nonce')::uuid,
        p_media_id,
        encode(extensions.digest(convert_to(p_proof_payload, 'UTF8'), 'sha256'), 'hex')
    );

    UPDATE public.media_assets
    SET lifecycle_status = 'ACTIVE',
        activated_at = pg_catalog.now(),
        sha256_hex = v_proof->>'sha256'
    WHERE id = p_media_id;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_media_upload(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_media_upload(uuid, text, text) TO authenticated;

-- The previous trigger accepted any Auth hash change, including reusing the
-- same password. Only the dedicated authenticated server route may clear it.
DROP TRIGGER IF EXISTS trg_clear_legacy_password_gate_after_auth_password_update ON auth.users;
DROP FUNCTION IF EXISTS private.clear_legacy_password_gate_after_auth_update();

CREATE OR REPLACE FUNCTION public.clear_legacy_password_gate_after_verified_change(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.role() <> 'service_role' OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'server-only password change completion required' USING ERRCODE = '42501';
    END IF;
    UPDATE private.legacy_user_identity
    SET legacy_must_change_password = false
    WHERE auth_user_id = p_user_id AND legacy_must_change_password IS TRUE;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_legacy_password_gate_after_verified_change(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_legacy_password_gate_after_verified_change(uuid) TO service_role;
