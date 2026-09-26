-- Append-only media lifecycle hardening. Existing rows/objects and legacy
-- rights metadata are preserved; no hosted migration is run by this file.

ALTER TABLE public.media_assets
    ADD COLUMN cleanup_after timestamptz;

COMMENT ON COLUMN public.media_assets.cleanup_after IS
    'Earliest time at which a detached, tombstoned object may be physically removed; visibility is revoked immediately.';

CREATE INDEX idx_media_assets_cleanup_after
    ON public.media_assets (cleanup_after, id)
    WHERE lifecycle_status = 'DELETE_PENDING';

-- Newly detached objects remain tombstoned for seven days. The visibility
-- helpers already require ACTIVE plus a live menu/review association, so a
-- detachment revokes new signed reads in the same transaction.
CREATE OR REPLACE FUNCTION private.mark_menu_photo_detached()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.photo_media_id IS NOT NULL
       AND OLD.photo_media_id IS DISTINCT FROM NEW.photo_media_id THEN
        UPDATE public.media_assets AS a
        SET lifecycle_status = 'DELETE_PENDING',
            cleanup_after = COALESCE(a.cleanup_after, pg_catalog.now() + interval '7 days')
        WHERE a.id = OLD.photo_media_id
          AND a.lifecycle_status IN ('PENDING', 'ACTIVE', 'REVOKED')
          AND NOT EXISTS (
              SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = a.id
          );
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_review_photo_detached()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE public.media_assets AS a
    SET lifecycle_status = 'DELETE_PENDING',
        cleanup_after = COALESCE(a.cleanup_after, pg_catalog.now() + interval '7 days')
    WHERE a.id = OLD.media_id
      AND a.lifecycle_status IN ('PENDING', 'ACTIVE', 'REVOKED')
      AND NOT EXISTS (
          SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = a.id
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = a.id
      );
    RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_review_assets_detached()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE public.media_assets AS a
    SET lifecycle_status = 'DELETE_PENDING',
        cleanup_after = COALESCE(a.cleanup_after, pg_catalog.now() + interval '7 days')
    WHERE a.media_kind = 'REVIEW'
      AND a.review_id = OLD.id
      AND a.lifecycle_status IN ('PENDING', 'ACTIVE', 'REVOKED');
    RETURN OLD;
END;
$$;

-- The object is immediately hidden when queued. Uploaders may request cleanup
-- only for an unlinked object they uploaded; a server admin may reconcile any
-- uploader's object. Calls are idempotent and keep an existing grace deadline.
CREATE FUNCTION public.queue_media_cleanup(p_media_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_asset public.media_assets%ROWTYPE;
BEGIN
    IF v_user_id IS NULL OR p_media_id IS NULL THEN
        RAISE EXCEPTION 'authenticated media owner required' USING ERRCODE = '42501';
    END IF;

    SELECT a.* INTO v_asset
    FROM public.media_assets AS a
    WHERE a.id = p_media_id
    FOR UPDATE;
    IF NOT FOUND OR (v_asset.uploaded_by <> v_user_id AND NOT private.is_server_admin()) THEN
        RAISE EXCEPTION 'media asset unavailable' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = v_asset.id)
       OR EXISTS (SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = v_asset.id) THEN
        RETURN false;
    END IF;

    IF v_asset.lifecycle_status = 'DELETED' THEN
        RETURN true;
    END IF;
    IF v_asset.lifecycle_status = 'DELETE_PENDING' THEN
        RETURN true;
    END IF;
    IF v_asset.lifecycle_status NOT IN ('PENDING', 'ACTIVE', 'REVOKED') THEN
        RETURN false;
    END IF;

    UPDATE public.media_assets AS a
    SET lifecycle_status = 'DELETE_PENDING',
        cleanup_after = pg_catalog.now() + interval '7 days'
    WHERE a.id = v_asset.id;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_media_cleanup(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.queue_media_cleanup(uuid) TO authenticated;

-- Keep the prior public RPC compatible while applying the same visibility
-- tombstone and grace period to its callers.
CREATE OR REPLACE FUNCTION public.mark_unattached_media_for_delete(p_media_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    RETURN public.queue_media_cleanup(p_media_id);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_unattached_media_for_delete(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_unattached_media_for_delete(uuid) TO authenticated;

-- A caller can delete Storage bytes only after the tombstone grace period has
-- elapsed and the attachment tables are still empty. The delete guard takes the
-- asset row lock and repeats the no-link checks to serialize with attachment.
CREATE OR REPLACE FUNCTION private.can_delete_media_path(p_object_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.media_assets AS a
        WHERE a.object_path = p_object_path
          AND a.lifecycle_status = 'DELETE_PENDING'
          AND a.cleanup_after IS NOT NULL
          AND a.cleanup_after <= pg_catalog.now()
          AND (a.uploaded_by = auth.uid() OR private.is_server_admin())
          AND NOT EXISTS (SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = a.id)
    );
$$;
REVOKE ALL ON FUNCTION private.can_delete_media_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_delete_media_path(text) TO authenticated;

-- Preserve the old return shape for existing admin tooling; only eligible,
-- detached, grace-period-complete records are listed for physical retry.
CREATE OR REPLACE FUNCTION public.admin_list_media_cleanup_queue()
RETURNS TABLE (
    media_id uuid,
    object_path text,
    media_kind text,
    lifecycle_status text,
    created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_server_admin() THEN
        RAISE EXCEPTION 'server administrator required' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT a.id, a.object_path, a.media_kind, a.lifecycle_status, a.created_at
    FROM public.media_assets AS a
    WHERE a.lifecycle_status = 'DELETE_PENDING'
      AND a.cleanup_after IS NOT NULL
      AND a.cleanup_after <= pg_catalog.now()
      AND NOT EXISTS (SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = a.id)
    ORDER BY a.cleanup_after, a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_media_cleanup_queue()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_media_cleanup_queue() TO authenticated;

-- The earlier unauthenticated upload finalizer cannot verify browser-provided
-- bytes. Keep it available for compatibility; app reads still require ACTIVE
-- assets attached to an active menu or review, and upload paths stay immutable.
