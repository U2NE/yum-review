-- Serialize media-verification quota changes per authenticated caller. Invalid,
-- foreign, inactive, or unauthorized assets return before taking any advisory lock.
CREATE OR REPLACE FUNCTION public.consume_media_verification_attempt(p_media_id uuid)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_authorized_media_id uuid;
    v_now timestamptz;
    v_window_started_at timestamptz;
    v_attempts integer;
BEGIN
    IF v_user_id IS NULL OR p_media_id IS NULL THEN
        RETURN;
    END IF;

    -- This check deliberately precedes every advisory lock. Random or foreign
    -- IDs cannot contend on the global decoder gate or the caller quota lock.
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

    -- A stable per-user key serializes quota accounting without coupling users.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text, 19860926)
    );

    -- Repeat the eligibility check after waiting for the per-user lock and lock
    -- the asset row so a concurrent state transition cannot charge this request.
    SELECT a.id INTO v_authorized_media_id
    FROM public.media_assets AS a
    WHERE a.id = p_media_id
      AND a.uploaded_by = v_user_id
      AND a.lifecycle_status = 'PENDING'
      AND private.can_upload_media_path(a.object_path)
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_now := pg_catalog.clock_timestamp();

    -- Remove at most 32 stale quota rows per authorized request. SKIP LOCKED
    -- avoids interfering with another caller currently updating its own row.
    WITH stale_quotas AS MATERIALIZED (
        SELECT q.ctid
        FROM private.media_verification_quotas AS q
        WHERE q.window_started_at < v_now - interval '1 day'
        ORDER BY q.window_started_at, q.user_id
        LIMIT 32
        FOR UPDATE SKIP LOCKED
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

-- The service-only slot claim is the sole owner of the shared decoder lock.
-- Check the authorized pending asset before entering that shared critical path,
-- then repeat the check after acquiring the lock to close state-change races.
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
          AND EXISTS (
              SELECT 1 FROM storage.objects AS o
              WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path
          )
    ) THEN
        RETURN;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(19860926, 1730);

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
          AND EXISTS (
              SELECT 1 FROM storage.objects AS o
              WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path
          )
    ) THEN
        RETURN;
    END IF;

    v_now := pg_catalog.clock_timestamp();

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

-- Serialize concurrent photo inserts on the parent review row and cap every
-- insert/update path at five linked photos without changing existing rows.
CREATE OR REPLACE FUNCTION private.enforce_review_photo_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_review_id bigint;
    v_photo_count integer;
BEGIN
    SELECT r.id INTO v_review_id
    FROM public.reviews AS r
    WHERE r.id = NEW.review_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'review is unavailable' USING ERRCODE = '23503';
    END IF;

    IF TG_OP = 'INSERT' AND EXISTS (
        SELECT 1
        FROM public.review_photos AS rp
        WHERE rp.review_id = NEW.review_id
          AND rp.media_id = NEW.media_id
    ) THEN
        -- Idempotent upserts that already link this photo add no slot.
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT count(*) INTO v_photo_count
        FROM public.review_photos AS rp
        WHERE rp.review_id = NEW.review_id
          AND NOT (rp.review_id = OLD.review_id AND rp.media_id = OLD.media_id);
    ELSE
        SELECT count(*) INTO v_photo_count
        FROM public.review_photos AS rp
        WHERE rp.review_id = NEW.review_id;
    END IF;

    IF v_photo_count >= 5 THEN
        RAISE EXCEPTION 'a review can have at most five photos' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_review_photo_limit()
    FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_enforce_review_photo_limit ON public.review_photos;
CREATE TRIGGER trg_enforce_review_photo_limit
    BEFORE INSERT OR UPDATE OF review_id, media_id ON public.review_photos
    FOR EACH ROW EXECUTE FUNCTION private.enforce_review_photo_limit();

-- A review author may still hydrate the menu metadata for their own review
-- after the menu is deactivated. The definer helper avoids RLS recursion and
-- exposes no inactive menu to guests or unrelated signed-in users.
CREATE OR REPLACE FUNCTION private.has_review_on_menu(p_menu_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.reviews AS r
        WHERE r.menu_id = p_menu_id
          AND r.user_id = auth.uid()
    );
$$;
REVOKE ALL ON FUNCTION private.has_review_on_menu(bigint)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_review_on_menu(bigint) TO authenticated;
DROP POLICY IF EXISTS menus_review_author_read ON public.menus;
CREATE POLICY menus_review_author_read ON public.menus
    FOR SELECT TO authenticated
    USING ((SELECT private.has_review_on_menu(id)));
