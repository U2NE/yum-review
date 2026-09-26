-- Private, narrowly-scoped policy helpers. Every SECURITY DEFINER function fixes
-- search_path to pg_catalog and schema-qualifies every non-catalog reference.

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.is_server_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM private.user_roles AS ur
        WHERE ur.user_id = auth.uid()
          AND ur.role_code = 'SERVER_ADMIN'
    );
$$;

CREATE FUNCTION private.owns_restaurant(p_restaurant_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM private.restaurant_owners AS ro
        WHERE ro.user_id = auth.uid()
          AND ro.restaurant_id = p_restaurant_id
    );
$$;

CREATE FUNCTION private.is_public_media_id(p_media_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.media_assets AS a
        WHERE a.id = p_media_id
          AND a.lifecycle_status = 'ACTIVE'
          AND (
              (a.media_kind = 'MENU' AND EXISTS (
                  SELECT 1 FROM public.menus AS m
                  WHERE m.photo_media_id = a.id AND m.active = true
              ))
              OR
              (a.media_kind = 'REVIEW' AND EXISTS (
                  SELECT 1
                  FROM public.review_photos AS rp
                  JOIN public.reviews AS r ON r.id = rp.review_id
                  JOIN public.menus AS m ON m.id = r.menu_id
                  WHERE rp.media_id = a.id AND m.active = true
              ))
          )
    );
$$;

CREATE FUNCTION private.is_public_media_path(p_object_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.media_assets AS a
        WHERE a.object_path = p_object_path
          AND private.is_public_media_id(a.id)
    );
$$;

CREATE FUNCTION private.can_read_media_asset(p_media_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT private.is_public_media_id(p_media_id)
        OR EXISTS (
            SELECT 1 FROM public.media_assets AS a
            WHERE a.id = p_media_id AND a.uploaded_by = auth.uid()
        );
$$;

CREATE FUNCTION private.can_attach_menu_photo(p_menu_id bigint, p_media_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT p_media_id IS NULL OR EXISTS (
        SELECT 1
        FROM public.menus AS m
        JOIN public.media_assets AS a ON a.id = p_media_id
        WHERE m.id = p_menu_id
          AND a.media_kind = 'MENU'
          AND a.menu_id = m.id
          AND a.lifecycle_status = 'ACTIVE'
          AND EXISTS (
              SELECT 1 FROM storage.objects AS o
              WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path
          )
          AND (
              a.uploaded_by = auth.uid()
              OR private.is_server_admin()
              OR m.photo_media_id = a.id
          )
    );
$$;

CREATE FUNCTION private.can_attach_review_photo(p_review_id bigint, p_media_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.reviews AS r
        JOIN public.menus AS m ON m.id = r.menu_id
        JOIN public.media_assets AS a ON a.id = p_media_id
        WHERE r.id = p_review_id
          AND r.user_id = auth.uid()
          AND m.active = true
          AND a.media_kind = 'REVIEW'
          AND a.review_id = r.id
          AND a.uploaded_by = auth.uid()
          AND a.lifecycle_status = 'ACTIVE'
          AND EXISTS (
              SELECT 1 FROM storage.objects AS o
              WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path
          )
    );
$$;

CREATE FUNCTION private.can_upload_media_path(p_object_path text)
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
          AND a.uploaded_by = auth.uid()
          AND a.lifecycle_status = 'PENDING'
          AND (
              (a.media_kind = 'MENU' AND EXISTS (
                  SELECT 1 FROM public.menus AS m
                  WHERE m.id = a.menu_id
                    AND m.active = true
                    AND (private.is_server_admin() OR private.owns_restaurant(m.restaurant_id))
              ))
              OR
              (a.media_kind = 'REVIEW' AND EXISTS (
                  SELECT 1 FROM public.reviews AS r
                  JOIN public.menus AS m ON m.id = r.menu_id
                  WHERE r.id = a.review_id
                    AND r.user_id = auth.uid()
                    AND m.active = true
              ))
          )
    );
$$;

CREATE FUNCTION private.can_delete_media_path(p_object_path text)
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
          AND a.lifecycle_status IN ('PENDING', 'DELETE_PENDING')
          AND (a.uploaded_by = auth.uid() OR private.is_server_admin())
          AND NOT EXISTS (
              SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = a.id
          )
    );
$$;

-- Serialize media attachment against cleanup by locking the referenced asset.
-- Ownership and target authorization remain in the existing RLS policy helper;
-- this trigger enforces only lifecycle and object-existence invariants.
CREATE FUNCTION private.guard_menu_photo_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_asset public.media_assets%ROWTYPE;
BEGIN
    IF NEW.photo_media_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT a.* INTO v_asset
    FROM public.media_assets AS a
    WHERE a.id = NEW.photo_media_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_asset.lifecycle_status <> 'ACTIVE'
       OR NOT EXISTS (
           SELECT 1 FROM storage.objects AS o
           WHERE o.bucket_id = 'yum-review-media' AND o.name = v_asset.object_path
       ) THEN
        RAISE EXCEPTION 'media asset is unavailable' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION private.guard_review_photo_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_asset public.media_assets%ROWTYPE;
BEGIN
    SELECT a.* INTO v_asset
    FROM public.media_assets AS a
    WHERE a.id = NEW.media_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_asset.lifecycle_status <> 'ACTIVE'
       OR NOT EXISTS (
           SELECT 1 FROM storage.objects AS o
           WHERE o.bucket_id = 'yum-review-media' AND o.name = v_asset.object_path
       ) THEN
        RAISE EXCEPTION 'media asset is unavailable' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

-- The Storage DELETE trigger uses the same asset-row lock as the attachment
-- triggers. If cleanup wins, a waiting attachment observes the non-ACTIVE
-- state/object removal; if attachment wins, cleanup observes the link and fails.
CREATE FUNCTION private.guard_media_storage_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_asset public.media_assets%ROWTYPE;
BEGIN
    IF OLD.bucket_id <> 'yum-review-media' THEN
        RETURN OLD;
    END IF;

    SELECT a.* INTO v_asset
    FROM public.media_assets AS a
    WHERE a.object_path = OLD.name
    FOR UPDATE;

    IF NOT FOUND
       OR v_asset.lifecycle_status NOT IN ('PENDING', 'DELETE_PENDING')
       OR EXISTS (
           SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = v_asset.id
       )
       OR EXISTS (
           SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = v_asset.id
       ) THEN
        RAISE EXCEPTION 'media object is attached or not queued for deletion'
            USING ERRCODE = '42501';
    END IF;

    RETURN OLD;
END;
$$;

-- When a public attachment is removed, move the asset into a non-attachable
-- cleanup state in the same transaction. Storage removal can then be retried
-- without making the photo public or allowing a later reattachment.
CREATE FUNCTION private.mark_menu_photo_detached()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.photo_media_id IS NOT NULL
       AND OLD.photo_media_id IS DISTINCT FROM NEW.photo_media_id THEN
        UPDATE public.media_assets AS a
        SET lifecycle_status = 'DELETE_PENDING'
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

CREATE FUNCTION private.mark_review_photo_detached()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    UPDATE public.media_assets AS a
    SET lifecycle_status = 'DELETE_PENDING'
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

CREATE FUNCTION private.mark_review_assets_detached()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Include upload intents that were created for this review but had not yet
    -- been attached when the review was deleted.
    UPDATE public.media_assets AS a
    SET lifecycle_status = 'DELETE_PENDING'
    WHERE a.media_kind = 'REVIEW'
      AND a.review_id = OLD.id
      AND a.lifecycle_status IN ('PENDING', 'ACTIVE', 'REVOKED');
    RETURN OLD;
END;
$$;

CREATE FUNCTION private.mark_media_asset_deleted_after_storage_remove()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.bucket_id = 'yum-review-media' THEN
        UPDATE public.media_assets AS a
        SET lifecycle_status = 'DELETED'
        WHERE a.object_path = OLD.name
          AND a.lifecycle_status IN ('PENDING', 'DELETE_PENDING')
          AND NOT EXISTS (
              SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = a.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = a.id
          );
    END IF;
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.mark_menu_photo_detached() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.mark_review_photo_detached() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.mark_review_assets_detached() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.mark_media_asset_deleted_after_storage_remove()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_menu_photo_attachment()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_review_photo_attachment()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_media_storage_delete()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_menu_photo_attachment_guard
    BEFORE INSERT OR UPDATE OF photo_media_id ON public.menus
    FOR EACH ROW EXECUTE FUNCTION private.guard_menu_photo_attachment();
CREATE TRIGGER trg_review_photo_attachment_guard
    BEFORE INSERT OR UPDATE OF review_id, media_id ON public.review_photos
    FOR EACH ROW EXECUTE FUNCTION private.guard_review_photo_attachment();
CREATE TRIGGER trg_storage_media_delete_guard
    BEFORE DELETE ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION private.guard_media_storage_delete();

CREATE TRIGGER trg_menu_photo_detached
    AFTER UPDATE OF photo_media_id ON public.menus
    FOR EACH ROW EXECUTE FUNCTION private.mark_menu_photo_detached();
CREATE TRIGGER trg_review_photo_detached
    AFTER DELETE ON public.review_photos
    FOR EACH ROW EXECUTE FUNCTION private.mark_review_photo_detached();
CREATE TRIGGER trg_review_assets_detached
    AFTER DELETE ON public.reviews
    FOR EACH ROW EXECUTE FUNCTION private.mark_review_assets_detached();
CREATE TRIGGER trg_storage_media_asset_deleted
    AFTER DELETE ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION private.mark_media_asset_deleted_after_storage_remove();

CREATE FUNCTION public.admin_list_media_cleanup_queue()
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
      AND NOT EXISTS (
          SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = a.id
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = a.id
      )
      AND EXISTS (
          SELECT 1 FROM storage.objects AS o
          WHERE o.bucket_id = 'yum-review-media' AND o.name = a.object_path
      )
    ORDER BY a.created_at, a.id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_media_cleanup_queue()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_media_cleanup_queue() TO authenticated;

-- A menu image may be uploaded and activated before it is attached. The uploader
-- or a server admin can explicitly queue only an ACTIVE, currently unlinked
-- object for physical cleanup. The call returns no path or asset metadata.
CREATE FUNCTION public.mark_unattached_media_for_delete(p_media_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_asset public.media_assets%ROWTYPE;
    v_rows_updated integer;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_media_id IS NULL THEN
        RAISE EXCEPTION 'media asset is unavailable' USING ERRCODE = '42501';
    END IF;

    SELECT a.* INTO v_asset
    FROM public.media_assets AS a
    WHERE a.id = p_media_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'media asset is unavailable' USING ERRCODE = '42501';
    END IF;
    IF v_asset.uploaded_by <> v_user_id AND NOT private.is_server_admin() THEN
        RAISE EXCEPTION 'media asset is unavailable' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
           SELECT 1 FROM public.menus AS m WHERE m.photo_media_id = v_asset.id
       )
       OR EXISTS (
           SELECT 1 FROM public.review_photos AS rp WHERE rp.media_id = v_asset.id
       )
       OR NOT EXISTS (
           SELECT 1 FROM storage.objects AS o
           WHERE o.bucket_id = 'yum-review-media' AND o.name = v_asset.object_path
       ) THEN
        RETURN false;
    END IF;

    IF v_asset.lifecycle_status = 'DELETE_PENDING' THEN
        RETURN true;
    END IF;
    IF v_asset.lifecycle_status <> 'ACTIVE' THEN
        RETURN false;
    END IF;

    UPDATE public.media_assets AS a
    SET lifecycle_status = 'DELETE_PENDING'
    WHERE a.id = v_asset.id AND a.lifecycle_status = 'ACTIVE';
    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_unattached_media_for_delete(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_unattached_media_for_delete(uuid)
    TO authenticated;

REVOKE ALL ON FUNCTION private.is_server_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.owns_restaurant(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_public_media_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_public_media_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_read_media_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_attach_menu_photo(bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_attach_review_photo(bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_upload_media_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_delete_media_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_server_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.owns_restaurant(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_public_media_id(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_public_media_path(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_media_asset(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_attach_menu_photo(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_attach_review_photo(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_upload_media_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_delete_media_path(text) TO authenticated;

-- RLS policies: public reads are limited to the active catalog; mutations follow
-- Auth UUID ownership or trusted private role/restaurant-owner records.
CREATE POLICY profiles_public_read ON public.profiles
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY profiles_self_update ON public.profiles
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY restaurants_public_read ON public.restaurants
    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY restaurants_admin_insert ON public.restaurants
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT private.is_server_admin()));
CREATE POLICY restaurants_admin_update ON public.restaurants
    FOR UPDATE TO authenticated
    USING ((SELECT private.is_server_admin()))
    WITH CHECK ((SELECT private.is_server_admin()));

CREATE POLICY menus_public_or_manager_read ON public.menus
    FOR SELECT TO anon, authenticated
    USING (
        active = true
        OR (SELECT private.is_server_admin())
        OR (SELECT private.owns_restaurant(restaurant_id))
    );
CREATE POLICY menus_manager_insert ON public.menus
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT private.is_server_admin())
        OR (SELECT private.owns_restaurant(restaurant_id))
    );
CREATE POLICY menus_manager_update ON public.menus
    FOR UPDATE TO authenticated
    USING (
        (SELECT private.is_server_admin())
        OR (SELECT private.owns_restaurant(restaurant_id))
    )
    WITH CHECK (
        (
            (SELECT private.is_server_admin())
            OR (SELECT private.owns_restaurant(restaurant_id))
        )
        AND (SELECT private.can_attach_menu_photo(id, photo_media_id))
    );

CREATE POLICY reviews_public_or_private_read ON public.reviews
    FOR SELECT TO anon, authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR (SELECT private.is_server_admin())
        OR EXISTS (
            SELECT 1 FROM public.menus AS m
            WHERE m.id = reviews.menu_id AND m.active = true
        )
    );
CREATE POLICY reviews_self_insert ON public.reviews
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND non_event_review_consent IS TRUE
        AND EXISTS (
            SELECT 1 FROM public.menus AS m
            WHERE m.id = reviews.menu_id AND m.active = true
        )
    );
CREATE POLICY reviews_self_update ON public.reviews
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND non_event_review_consent IS TRUE
        AND EXISTS (
            SELECT 1 FROM public.menus AS m
            WHERE m.id = reviews.menu_id AND m.active = true
        )
    );
CREATE POLICY reviews_self_or_server_admin_delete ON public.reviews
    FOR DELETE TO authenticated
    USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_server_admin()));

CREATE POLICY media_assets_public_or_uploader_read ON public.media_assets
    FOR SELECT TO anon, authenticated
    USING ((SELECT private.can_read_media_asset(id)));

CREATE POLICY review_photos_visible_review_read ON public.review_photos
    FOR SELECT TO anon, authenticated
    USING (EXISTS (
        SELECT 1 FROM public.reviews AS r WHERE r.id = review_photos.review_id
    ));
CREATE POLICY review_photos_author_insert ON public.review_photos
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reviews AS r
            JOIN public.menus AS m ON m.id = r.menu_id
            WHERE r.id = review_photos.review_id
              AND r.user_id = (SELECT auth.uid())
              AND m.active = true
        )
        AND (SELECT private.can_attach_review_photo(review_photos.review_id, review_photos.media_id))
    );
CREATE POLICY review_photos_author_or_admin_delete ON public.review_photos
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.reviews AS r
            WHERE r.id = review_photos.review_id
              AND r.user_id = (SELECT auth.uid())
        )
        OR (SELECT private.is_server_admin())
    );

-- Users can inspect only their own like rows (needed to filter/toggle unlike).
-- Public like totals and per-caller state are exposed through a separate aggregate RPC.
CREATE POLICY review_likes_self_read ON public.review_likes
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY review_likes_self_insert ON public.review_likes
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.reviews AS r
            JOIN public.menus AS m ON m.id = r.menu_id
            WHERE r.id = review_likes.review_id
              AND r.user_id <> (SELECT auth.uid())
              AND m.active = true
        )
    );
CREATE POLICY review_likes_self_delete ON public.review_likes
    FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY menu_wishlists_self_read ON public.menu_wishlists
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY menu_wishlists_self_insert ON public.menu_wishlists
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.menus AS m
            WHERE m.id = menu_wishlists.menu_id AND m.active = true
        )
    );
CREATE POLICY menu_wishlists_self_delete ON public.menu_wishlists
    FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- Remove inherited/default broad grants, then grant only the client columns and
-- operations needed by the application. service_role stays server-only.
REVOKE ALL ON public.profiles, public.restaurants, public.menus, public.reviews,
    public.media_assets, public.review_photos, public.review_likes,
    public.menu_wishlists FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.profiles, public.restaurants, public.menus, public.reviews,
    public.review_photos TO anon, authenticated;
GRANT SELECT (id, object_path, media_kind, content_type, created_at)
    ON public.media_assets TO anon, authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
GRANT INSERT (name, description, address, region, latitude, longitude)
    ON public.restaurants TO authenticated;
GRANT UPDATE (name, description, address, region, latitude, longitude)
    ON public.restaurants TO authenticated;
GRANT INSERT (restaurant_id, name, description, price_krw, cuisine_category, active)
    ON public.menus TO authenticated;
GRANT UPDATE (name, description, price_krw, cuisine_category, active, photo_media_id)
    ON public.menus TO authenticated;
GRANT INSERT (user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent)
    ON public.reviews TO authenticated;
GRANT UPDATE (overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent)
    ON public.reviews TO authenticated;
GRANT DELETE ON public.reviews TO authenticated;
GRANT INSERT (review_id, media_id, sort_order) ON public.review_photos TO authenticated;
GRANT DELETE ON public.review_photos TO authenticated;
GRANT INSERT (user_id, review_id) ON public.review_likes TO authenticated;
GRANT SELECT (user_id, review_id) ON public.review_likes TO authenticated;
GRANT DELETE ON public.review_likes TO authenticated;
GRANT SELECT ON public.menu_wishlists TO authenticated;
GRANT INSERT (user_id, menu_id) ON public.menu_wishlists TO authenticated;
GRANT DELETE ON public.menu_wishlists TO authenticated;
GRANT ALL ON public.profiles, public.restaurants, public.menus, public.reviews,
    public.media_assets, public.review_photos, public.review_likes,
    public.menu_wishlists TO service_role;
GRANT USAGE ON SEQUENCE public.restaurants_id_seq, public.menus_id_seq, public.reviews_id_seq
    TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.restaurants_id_seq, public.menus_id_seq, public.reviews_id_seq
    TO service_role;

CREATE FUNCTION public.get_review_like_summaries(p_review_ids bigint[])
RETURNS TABLE (review_id bigint, like_count bigint, liked_by_me boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_review_ids IS NULL OR pg_catalog.cardinality(p_review_ids) < 1
       OR pg_catalog.cardinality(p_review_ids) > 100 THEN
        RAISE EXCEPTION 'provide between 1 and 100 review IDs';
    END IF;

    RETURN QUERY
    SELECT r.id,
           pg_catalog.count(rl.review_id)::bigint,
           COALESCE(pg_catalog.bool_or(rl.user_id = auth.uid()), false)
    FROM public.reviews AS r
    JOIN public.menus AS m ON m.id = r.menu_id AND m.active = true
    LEFT JOIN public.review_likes AS rl ON rl.review_id = r.id
    WHERE r.id = ANY (p_review_ids)
    GROUP BY r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_review_like_summaries(bigint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_review_like_summaries(bigint[]) TO anon, authenticated;

-- Aggregate ratings inside PostgreSQL to avoid PostgREST's row limit affecting
-- menu averages. This is SECURITY INVOKER: menu/review RLS remains the visibility
-- boundary, and the return shape contains no reviewer identifiers.
CREATE FUNCTION public.get_menu_review_summaries(p_menu_ids bigint[])
RETURNS TABLE (
    menu_id bigint,
    review_count bigint,
    overall_avg numeric,
    taste_avg numeric,
    value_avg numeric,
    portion_avg numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_menu_ids IS NULL OR pg_catalog.cardinality(p_menu_ids) < 1
       OR pg_catalog.cardinality(p_menu_ids) > 100 THEN
        RAISE EXCEPTION 'provide between 1 and 100 menu IDs';
    END IF;

    RETURN QUERY
    WITH requested AS (
        SELECT DISTINCT pg_catalog.unnest(p_menu_ids) AS requested_menu_id
    )
    SELECT m.id,
           pg_catalog.count(r.id)::bigint,
           pg_catalog.avg(r.overall_score),
           pg_catalog.avg(r.taste_score),
           pg_catalog.avg(r.value_score),
           pg_catalog.avg(r.portion_score)
    FROM requested AS q
    JOIN public.menus AS m
      ON m.id = q.requested_menu_id
     AND m.active = true
    LEFT JOIN public.reviews AS r ON r.menu_id = m.id
    GROUP BY m.id
    ORDER BY m.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_menu_review_summaries(bigint[])
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_menu_review_summaries(bigint[])
    TO anon, authenticated;

CREATE FUNCTION public.create_media_upload_intent(
    p_media_kind text,
    p_menu_id bigint DEFAULT NULL,
    p_review_id bigint DEFAULT NULL,
    p_content_type text DEFAULT NULL,
    p_original_bytes bigint DEFAULT NULL,
    p_stored_bytes bigint DEFAULT NULL
)
RETURNS TABLE (media_id uuid, object_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_media_id uuid := pg_catalog.gen_random_uuid();
    v_extension text;
    v_object_path text;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_content_type IS NULL OR p_content_type NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
        RAISE EXCEPTION 'unsupported image type';
    END IF;
    IF p_original_bytes IS NULL OR p_original_bytes < 1 OR p_original_bytes >= 100000000
       OR p_stored_bytes IS NULL OR p_stored_bytes < 1 OR p_stored_bytes >= 100000000 THEN
        RAISE EXCEPTION 'image size must be below 100,000,000 bytes';
    END IF;

    v_extension := CASE p_content_type
        WHEN 'image/jpeg' THEN 'jpg'
        WHEN 'image/png' THEN 'png'
        WHEN 'image/webp' THEN 'webp'
    END;

    IF p_media_kind = 'MENU'
       AND p_menu_id IS NOT NULL
       AND p_review_id IS NULL
       AND EXISTS (
            SELECT 1 FROM public.menus AS m
            WHERE m.id = p_menu_id AND m.active = true
              AND (private.is_server_admin() OR private.owns_restaurant(m.restaurant_id))
       ) THEN
        v_object_path := 'menu/' || v_user_id::text || '/' || v_media_id::text || '.' || v_extension;
    ELSIF p_media_kind = 'REVIEW'
       AND p_menu_id IS NULL
       AND p_review_id IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM public.reviews AS r
            JOIN public.menus AS m ON m.id = r.menu_id
            WHERE r.id = p_review_id AND r.user_id = v_user_id AND m.active = true
       ) THEN
        v_object_path := 'review/' || v_user_id::text || '/' || v_media_id::text || '.' || v_extension;
    ELSE
        RAISE EXCEPTION 'not allowed to upload for this target' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.media_assets (
        id, object_path, media_kind, uploaded_by, menu_id, review_id,
        content_type, original_bytes, stored_bytes, lifecycle_status
    ) VALUES (
        v_media_id, v_object_path, p_media_kind, v_user_id, p_menu_id, p_review_id,
        p_content_type, p_original_bytes, p_stored_bytes, 'PENDING'
    );

    RETURN QUERY SELECT v_media_id, v_object_path;
END;
$$;
REVOKE ALL ON FUNCTION public.create_media_upload_intent(text, bigint, bigint, text, bigint, bigint)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_media_upload_intent(text, bigint, bigint, text, bigint, bigint)
    TO authenticated;

CREATE FUNCTION public.activate_media_upload(p_media_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_asset public.media_assets%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT a.* INTO v_asset
    FROM public.media_assets AS a
    WHERE a.id = p_media_id
      AND a.uploaded_by = v_user_id
      AND a.lifecycle_status = 'PENDING'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'upload intent not found' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM storage.objects AS o
        WHERE o.bucket_id = 'yum-review-media' AND o.name = v_asset.object_path
    ) THEN
        RAISE EXCEPTION 'uploaded object is missing';
    END IF;
    IF NOT private.can_upload_media_path(v_asset.object_path) THEN
        RAISE EXCEPTION 'upload target is no longer authorized' USING ERRCODE = '42501';
    END IF;

    UPDATE public.media_assets
    SET lifecycle_status = 'ACTIVE', activated_at = pg_catalog.now()
    WHERE id = p_media_id;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_media_upload(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_media_upload(uuid) TO authenticated;

CREATE FUNCTION public.admin_set_restaurant_owner(
    p_user_id uuid,
    p_restaurant_id bigint,
    p_is_owner boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT private.is_server_admin() THEN
        RAISE EXCEPTION 'server administrator required' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL OR p_restaurant_id IS NULL OR p_is_owner IS NULL THEN
        RAISE EXCEPTION 'user, restaurant, and assignment state are required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p_user_id)
       OR NOT EXISTS (SELECT 1 FROM public.restaurants AS r WHERE r.id = p_restaurant_id) THEN
        RAISE EXCEPTION 'user or restaurant not found';
    END IF;

    IF p_is_owner THEN
        INSERT INTO private.restaurant_owners (user_id, restaurant_id, assigned_by)
        VALUES (p_user_id, p_restaurant_id, auth.uid())
        ON CONFLICT (user_id, restaurant_id) DO NOTHING;
    ELSE
        DELETE FROM private.restaurant_owners
        WHERE user_id = p_user_id AND restaurant_id = p_restaurant_id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_restaurant_owner(uuid, bigint, boolean)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_restaurant_owner(uuid, bigint, boolean) TO authenticated;

-- Minimal authenticated role context for navigation and route guards. It returns
-- only the caller's server-admin flag and restaurant IDs assigned to that caller.
CREATE FUNCTION public.get_my_access()
RETURNS TABLE (is_server_admin boolean, owner_restaurant_ids bigint[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT private.is_server_admin(),
           COALESCE(
               pg_catalog.array_agg(ro.restaurant_id ORDER BY ro.restaurant_id),
               ARRAY[]::bigint[]
           )
    FROM private.restaurant_owners AS ro
    WHERE ro.user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_access() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_access() TO authenticated;

-- The server-admin check occurs inside the function before any private ownership
-- rows are returned. User IDs are the only identity fields exposed; emails and
-- legacy identity/role records remain private.
CREATE FUNCTION public.admin_list_restaurant_owners()
RETURNS TABLE (user_id uuid, restaurant_id bigint)
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
    SELECT ro.user_id, ro.restaurant_id
    FROM private.restaurant_owners AS ro
    ORDER BY ro.restaurant_id, ro.user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_restaurant_owners() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_restaurant_owners() TO authenticated;

-- RLS on these exposed relations must not be bypassed by table owners except the
-- trusted migration/service role. Application writes continue to use caller JWTs.
