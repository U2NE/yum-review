-- Keep one atomic fixed-window quota row per user. The table has no client
-- grants; only the narrowly scoped authenticated RPC can update it.
CREATE TABLE private.media_verification_rate_limits (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    window_started_at timestamptz NOT NULL,
    attempt_count smallint NOT NULL CHECK (attempt_count BETWEEN 1 AND 5),
    updated_at timestamptz NOT NULL
);
REVOKE ALL ON TABLE private.media_verification_rate_limits
    FROM PUBLIC, anon, authenticated, service_role;

-- Counts at most five requests per authenticated user's fixed UTC-aligned
-- 60-second window. An absent row means the supplied media ID is not the
-- caller's authorized PENDING upload, so no ownership information is returned.
CREATE FUNCTION public.consume_media_verification_attempt(p_media_id uuid)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_object_path text;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_window_started_at timestamptz;
    v_attempt_count smallint;
    v_retry_after integer;
BEGIN
    IF v_user_id IS NULL OR p_media_id IS NULL THEN
        RETURN;
    END IF;

    SELECT a.object_path INTO v_object_path
    FROM public.media_assets AS a
    WHERE a.id = p_media_id
      AND a.uploaded_by = v_user_id
      AND a.lifecycle_status = 'PENDING'
      AND private.can_upload_media_path(a.object_path)
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_window_started_at := pg_catalog.to_timestamp(
        pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / 60) * 60
    );

    INSERT INTO private.media_verification_rate_limits AS current_state (
        user_id, window_started_at, attempt_count, updated_at
    ) VALUES (
        v_user_id, v_window_started_at, 1, v_now
    )
    ON CONFLICT (user_id) DO UPDATE
    SET window_started_at = EXCLUDED.window_started_at,
        attempt_count = CASE
            WHEN current_state.window_started_at = EXCLUDED.window_started_at
                THEN current_state.attempt_count + 1
            ELSE 1
        END,
        updated_at = EXCLUDED.updated_at
    WHERE current_state.window_started_at <> EXCLUDED.window_started_at
       OR current_state.attempt_count < 5
    RETURNING attempt_count INTO v_attempt_count;

    IF FOUND THEN
        RETURN QUERY SELECT true, 0;
        RETURN;
    END IF;

    SELECT state.window_started_at INTO v_window_started_at
    FROM private.media_verification_rate_limits AS state
    WHERE state.user_id = v_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'media verification quota state unavailable';
    END IF;

    v_retry_after := GREATEST(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', v_window_started_at + interval '60 seconds' - v_now))::integer
    );
    RETURN QUERY SELECT false, LEAST(v_retry_after, 60);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_media_verification_attempt(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_media_verification_attempt(uuid)
    TO authenticated;
