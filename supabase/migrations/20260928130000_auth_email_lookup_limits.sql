CREATE TABLE private.auth_email_lookup_rate_limits (
    ip_hash text PRIMARY KEY CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
    window_started_at timestamptz NOT NULL,
    attempt_count smallint NOT NULL CHECK (attempt_count BETWEEN 1 AND 10),
    updated_at timestamptz NOT NULL
);

CREATE INDEX auth_email_lookup_rate_limits_window_idx
    ON private.auth_email_lookup_rate_limits (window_started_at);

REVOKE ALL ON TABLE private.auth_email_lookup_rate_limits
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.lookup_auth_email_status(p_email text, p_ip_hash text)
RETURNS TABLE (allowed boolean, email_exists boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_attempted_window_started_at timestamptz;
    v_window_started_at timestamptz;
    v_attempt_count smallint;
    v_retry_after integer;
    v_email_exists boolean;
BEGIN
    IF p_email IS NULL
       OR pg_catalog.length(v_email) > 254
       OR v_email = ''
       OR p_ip_hash IS NULL
       OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN QUERY SELECT false, NULL::boolean, 60;
        RETURN;
    END IF;

    LOOP
        v_now := pg_catalog.clock_timestamp();
        v_attempted_window_started_at := pg_catalog.to_timestamp(
            pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / 60) * 60
        );
        v_window_started_at := v_attempted_window_started_at;

        INSERT INTO private.auth_email_lookup_rate_limits AS current_state (
            ip_hash, window_started_at, attempt_count, updated_at
        ) VALUES (
            p_ip_hash, v_attempted_window_started_at, 1, v_now
        )
        ON CONFLICT (ip_hash) DO UPDATE
        SET window_started_at = EXCLUDED.window_started_at,
            attempt_count = CASE
                WHEN current_state.window_started_at = EXCLUDED.window_started_at
                    THEN current_state.attempt_count + 1
                ELSE 1
            END,
            updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.window_started_at > current_state.window_started_at
           OR (
                EXCLUDED.window_started_at = current_state.window_started_at
                AND current_state.attempt_count < 10
           )
        RETURNING attempt_count INTO v_attempt_count;

        EXIT WHEN FOUND;

        SELECT state.window_started_at
        INTO v_window_started_at
        FROM private.auth_email_lookup_rate_limits AS state
        WHERE state.ip_hash = p_ip_hash;
        IF NOT FOUND THEN
            RETURN QUERY SELECT false, NULL::boolean, 60;
            RETURN;
        END IF;

        -- A request may have waited on the per-IP row across a minute boundary.
        -- Rebucket it at the current time so it can use remaining quota instead
        -- of reporting the next reset as if this current bucket were full.
        v_now := pg_catalog.clock_timestamp();
        IF v_attempted_window_started_at < pg_catalog.to_timestamp(
               pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / 60) * 60
           )
           OR v_window_started_at < pg_catalog.to_timestamp(
               pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / 60) * 60
           ) THEN
            CONTINUE;
        END IF;

        v_retry_after := GREATEST(
            1,
            pg_catalog.ceil(pg_catalog.date_part('epoch', v_window_started_at + interval '60 seconds' - v_now))::integer
        );
        RETURN QUERY SELECT false, NULL::boolean, LEAST(v_retry_after, 60);
        RETURN;
    END LOOP;

    SELECT EXISTS (
        SELECT 1
        FROM auth.users AS user_row
        WHERE pg_catalog.lower(user_row.email) = v_email
    ) INTO v_email_exists;

    DELETE FROM private.auth_email_lookup_rate_limits AS expired
    WHERE expired.window_started_at < v_window_started_at - interval '10 minutes';

    RETURN QUERY SELECT true, v_email_exists, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_auth_email_status(text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_auth_email_status(text, text)
    TO service_role;
