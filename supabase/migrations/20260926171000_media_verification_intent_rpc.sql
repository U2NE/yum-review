-- Return only the caller's own authorized pending upload intent to the
-- verification route without widening media_assets column-level SELECT grants.
CREATE FUNCTION public.get_media_verification_intent(p_media_id uuid)
RETURNS TABLE (
    id uuid,
    object_path text,
    content_type text,
    original_bytes bigint,
    stored_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT a.id, a.object_path, a.content_type, a.original_bytes, a.stored_bytes
    FROM public.media_assets AS a
    WHERE auth.uid() IS NOT NULL
      AND a.id = p_media_id
      AND a.uploaded_by = auth.uid()
      AND a.lifecycle_status = 'PENDING'
      AND private.can_upload_media_path(a.object_path);
$$;

REVOKE ALL ON FUNCTION public.get_media_verification_intent(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_media_verification_intent(uuid)
    TO authenticated;
