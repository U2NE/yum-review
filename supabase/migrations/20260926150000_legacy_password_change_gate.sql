-- Enforce legacy forced-password changes at the database and UI boundaries.
-- The private mapping remains the source of truth; Auth metadata is not used.

CREATE OR REPLACE FUNCTION private.legacy_password_change_required()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM private.legacy_user_identity AS identity
        WHERE identity.auth_user_id = auth.uid()
          AND identity.legacy_must_change_password IS TRUE
    );
$$;
REVOKE ALL ON FUNCTION private.legacy_password_change_required()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.legacy_password_change_required() TO authenticated;

CREATE OR REPLACE FUNCTION public.legacy_password_change_required()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;
    RETURN private.legacy_password_change_required();
END;
$$;
REVOKE ALL ON FUNCTION public.legacy_password_change_required()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.legacy_password_change_required() TO authenticated;

CREATE OR REPLACE FUNCTION private.deny_writes_during_legacy_password_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF auth.uid() IS NOT NULL
       AND private.legacy_password_change_required() THEN
        RAISE EXCEPTION 'password change required before application writes'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.deny_writes_during_legacy_password_change()
    FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'profiles',
        'restaurants',
        'menus',
        'reviews',
        'media_assets',
        'review_photos',
        'review_likes',
        'menu_wishlists'
    ] LOOP
        EXECUTE pg_catalog.format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
            'FOR EACH ROW EXECUTE FUNCTION private.deny_writes_during_legacy_password_change()',
            'trg_legacy_password_gate_' || table_name,
            table_name
        );
    END LOOP;

    FOREACH table_name IN ARRAY ARRAY['user_roles', 'restaurant_owners'] LOOP
        EXECUTE pg_catalog.format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON private.%I '
            'FOR EACH ROW EXECUTE FUNCTION private.deny_writes_during_legacy_password_change()',
            'trg_legacy_password_gate_' || table_name,
            table_name
        );
    END LOOP;
END;
$$;

-- This runs only after Supabase Auth has committed a real encrypted_password
-- change. The client cannot clear the marker through metadata or an RPC.
CREATE OR REPLACE FUNCTION private.clear_legacy_password_gate_after_auth_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
        UPDATE private.legacy_user_identity
        SET legacy_must_change_password = false
        WHERE auth_user_id = NEW.id
          AND legacy_must_change_password IS TRUE;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.clear_legacy_password_gate_after_auth_update()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_clear_legacy_password_gate_after_auth_password_update
    AFTER UPDATE OF encrypted_password ON auth.users
    FOR EACH ROW
    WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
    EXECUTE FUNCTION private.clear_legacy_password_gate_after_auth_update();

-- A restrictive policy intersects the existing uploader/public-read policies,
-- so a forced-change user cannot bypass the gate through Storage REST/TUS calls.
CREATE POLICY yum_review_media_legacy_password_gate ON storage.objects
    AS RESTRICTIVE
    FOR ALL TO authenticated
    USING (NOT private.legacy_password_change_required())
    WITH CHECK (NOT private.legacy_password_change_required());

COMMENT ON FUNCTION public.legacy_password_change_required() IS
    'Returns only the authenticated caller’s private legacy forced-password-change state.';
