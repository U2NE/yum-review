CREATE TABLE private.location_search_quota (
    ip_hash text PRIMARY KEY CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
    window_started_at timestamptz NOT NULL,
    request_count smallint NOT NULL CHECK (request_count BETWEEN 1 AND 20)
);

CREATE INDEX location_search_quota_window_idx
    ON private.location_search_quota (window_started_at);

REVOKE ALL ON TABLE private.location_search_quota
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.consume_location_search_quota(p_ip_hash text)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_now timestamptz;
    v_bucket timestamptz;
    v_saved_bucket timestamptz;
    v_count smallint;
    v_retry integer;
BEGIN
    IF p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN QUERY SELECT false, NULL::integer, 60;
        RETURN;
    END IF;

    LOOP
        v_now := pg_catalog.clock_timestamp();
        v_bucket := pg_catalog.to_timestamp(
            pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / 60) * 60
        );

        INSERT INTO private.location_search_quota AS current_state (
            ip_hash, window_started_at, request_count
        ) VALUES (p_ip_hash, v_bucket, 1)
        ON CONFLICT (ip_hash) DO UPDATE
        SET window_started_at = EXCLUDED.window_started_at,
            request_count = CASE
                WHEN current_state.window_started_at = EXCLUDED.window_started_at
                    THEN current_state.request_count + 1
                ELSE 1
            END
        WHERE EXCLUDED.window_started_at > current_state.window_started_at
           OR (EXCLUDED.window_started_at = current_state.window_started_at
               AND current_state.request_count < 20)
        RETURNING request_count INTO v_count;

        IF FOUND THEN
            -- Bound maintenance work per admitted request, even after long inactivity.
            DELETE FROM private.location_search_quota AS expired
            WHERE expired.ctid IN (
                SELECT candidate.ctid
                FROM private.location_search_quota AS candidate
                WHERE candidate.window_started_at < v_bucket - interval '10 minutes'
                ORDER BY candidate.window_started_at
                LIMIT 100
            );
            RETURN QUERY SELECT true, 20 - v_count::integer, 0;
            RETURN;
        END IF;

        SELECT state.window_started_at
        INTO v_saved_bucket
        FROM private.location_search_quota AS state
        WHERE state.ip_hash = p_ip_hash;
        IF NOT FOUND THEN
            RETURN QUERY SELECT false, NULL::integer, 60;
            RETURN;
        END IF;

        -- A request may have waited across the next minute boundary on the row lock.
        v_now := pg_catalog.clock_timestamp();
        IF v_bucket < pg_catalog.to_timestamp(
               pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / 60) * 60
           ) OR v_saved_bucket < pg_catalog.to_timestamp(
               pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / 60) * 60
           ) THEN
            CONTINUE;
        END IF;

        v_retry := GREATEST(1, pg_catalog.ceil(pg_catalog.date_part(
            'epoch', v_saved_bucket + interval '60 seconds' - v_now
        ))::integer);
        RETURN QUERY SELECT false, NULL::integer, LEAST(v_retry, 60);
        RETURN;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_location_search_quota(text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_location_search_quota(text)
    TO service_role;
