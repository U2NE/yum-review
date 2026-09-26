-- Private bucket. A local bucket ceiling below 100 MB complements per-intent SQL
-- checks; production plan limits remain an operational gate.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'yum-review-media',
    'yum-review-media',
    false,
    99999999,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
);

CREATE POLICY yum_review_media_public_linked_read ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (
        bucket_id = 'yum-review-media'
        AND private.is_public_media_path(name)
    );

-- Authenticated uploaders can inspect their pending objects, and authorized
-- owners/admins can find unlinked objects that are safe for retryable cleanup.
CREATE POLICY yum_review_media_uploader_and_cleanup_read ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'yum-review-media'
        AND (
            private.can_upload_media_path(name)
            OR private.can_delete_media_path(name)
        )
    );

CREATE POLICY yum_review_media_authorized_upload ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'yum-review-media'
        AND private.can_upload_media_path(name)
    );

-- No UPDATE policy exists: Storage upserts/overwrites are denied. Deletion is
-- permitted only after the asset is no longer attached to any menu or review.
CREATE POLICY yum_review_media_unlinked_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'yum-review-media'
        AND private.can_delete_media_path(name)
    );
