-- Keep quota and lease cleanup bounded while the shared lock is held. Count an
-- authorized verification attempt separately so the route can check object
-- existence before reserving one of the global decoder slots.
CREATE INDEX IF NOT EXISTS media_verification_quotas_window_idx
    ON private.media_verification_quotas (window_started_at, user_id);

CREATE OR REPLACE FUNCTION public.consume_media_verification_attempt(p_media_id uuid)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_now timestamptz;
    v_window_started_at timestamptz;
    v_attempts integer;
BEGIN
    IF v_user_id IS NULL OR p_media_id IS NULL THEN
        RETURN;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(19860926, 1730);
    v_now := pg_catalog.clock_timestamp();

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

    -- Both columns match the quota index, and each call removes at most 32 rows.
    WITH stale_quotas AS MATERIALIZED (
        SELECT q.ctid
        FROM private.media_verification_quotas AS q
        WHERE q.window_started_at < v_now - interval '1 day'
        ORDER BY q.window_started_at, q.user_id
        LIMIT 32
    )
    DELETE FROM private.media_verification_quotas AS q
    USING stale_quotas AS stale
    WHERE q.ctid = stale.ctid
      AND q.window_started_at < v_now - interval '1 day';

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
        RETURN QUERY SELECT false,
            greatest(1, least(60, ceil(extract(epoch FROM (v_window_started_at + interval '60 seconds' - v_now)))::integer));
        RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_media_verification_attempt(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_media_verification_attempt(uuid)
    TO authenticated;

-- Charge attempts in consume_media_verification_attempt; this server-only RPC
-- now reserves capacity only after the caller-visible object existence check.
CREATE OR REPLACE FUNCTION public.claim_media_verification_slot_server(p_media_id uuid, p_user_id uuid)
RETURNS TABLE (allowed boolean, lease_token text, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_now timestamptz;
    v_active_count bigint;
    v_earliest_expiry timestamptz;
    v_lease_token text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'server-only media verification slot required' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL OR p_media_id IS NULL THEN
        RETURN;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(19860926, 1730);
    v_now := pg_catalog.clock_timestamp();

    IF NOT EXISTS (
        SELECT 1
        FROM public.media_assets AS a
        WHERE a.id = p_media_id
          AND a.uploaded_by = p_user_id
          AND a.lifecycle_status = 'PENDING'
          AND (
              (a.media_kind = 'MENU' AND EXISTS (
                  SELECT 1
                  FROM public.menus AS m
                  WHERE m.id = a.menu_id
                    AND m.active = true
                    AND (
                        EXISTS (
                            SELECT 1 FROM private.user_roles AS ur
                            WHERE ur.user_id = p_user_id AND ur.role_code = 'SERVER_ADMIN'
                        )
                        OR EXISTS (
                            SELECT 1 FROM private.restaurant_owners AS ro
                            WHERE ro.user_id = p_user_id AND ro.restaurant_id = m.restaurant_id
                        )
                    )
              ))
              OR (a.media_kind = 'REVIEW' AND EXISTS (
                  SELECT 1
                  FROM public.reviews AS r
                  JOIN public.menus AS m ON m.id = r.menu_id
                  WHERE r.id = a.review_id
                    AND r.user_id = p_user_id
                    AND m.active = true
              ))
          )
    ) THEN
        RETURN;
    END IF;

    -- The existing expiry index orders this bounded candidate scan. Materialize
    -- at most 32 row IDs before deleting, even when the stale backlog is larger.
    WITH expired_leases AS MATERIALIZED (
        SELECT l.ctid
        FROM private.media_verification_leases AS l
        WHERE l.expires_at <= v_now
        ORDER BY l.expires_at
        LIMIT 32
    )
    DELETE FROM private.media_verification_leases AS l
    USING expired_leases AS expired
    WHERE l.ctid = expired.ctid
      AND l.expires_at <= v_now;

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
        p_user_id,
        p_media_id,
        v_now + interval '90 seconds'
    );
    RETURN QUERY SELECT true, v_lease_token, NULL::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_media_verification_slot_server(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_media_verification_slot_server(uuid, uuid)
    TO service_role;
