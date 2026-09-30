-- Additive purge bookkeeping and identity attribution cleanup support.
-- No restaurant, menu, media row, Storage object, path, or byte is rewritten here.

CREATE TABLE private.personal_data_purge_journal (
    run_id VARCHAR(81) NOT NULL,
    target VARCHAR(32) NOT NULL,
    status VARCHAR(9) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    committed_at TIMESTAMPTZ,
    removed_rows BIGINT,
    remaining_rows BIGINT,
    removed_objects BIGINT,
    remaining_objects BIGINT,
    retained_menu_path_hmac VARCHAR(64),
    retained_menu_bytes_hmac VARCHAR(64),
    verified_at TIMESTAMPTZ,
    CONSTRAINT pk_personal_data_purge_journal PRIMARY KEY (run_id, target),
    CONSTRAINT ck_personal_data_purge_journal_run_id
        CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$'),
    CONSTRAINT ck_personal_data_purge_journal_target
        CHECK (target IN ('supabase-review-storage', 'supabase-db-auth', 'legacy-review-media', 'legacy-db')),
    CONSTRAINT ck_personal_data_purge_journal_checkpoint
        CHECK (
            (status = 'STARTED'
                AND committed_at IS NULL
                AND removed_rows IS NULL
                AND remaining_rows IS NULL
                AND removed_objects IS NULL
                AND remaining_objects IS NULL
                AND retained_menu_path_hmac IS NULL
                AND retained_menu_bytes_hmac IS NULL
                AND verified_at IS NULL)
            OR
            (status = 'COMMITTED'
                AND committed_at IS NOT NULL
                AND committed_at >= started_at
                AND removed_rows IS NOT NULL
                AND removed_rows >= 0
                AND remaining_rows IS NOT NULL
                AND remaining_rows = 0
                AND removed_objects IS NOT NULL
                AND removed_objects >= 0
                AND remaining_objects IS NOT NULL
                AND remaining_objects = 0
                AND retained_menu_path_hmac IS NOT NULL
                AND retained_menu_path_hmac ~ '^[0-9a-f]{64}$'
                AND retained_menu_bytes_hmac IS NOT NULL
                AND retained_menu_bytes_hmac ~ '^[0-9a-f]{64}$'
                AND verified_at IS NOT NULL
                AND verified_at >= started_at
                AND verified_at <= committed_at)
        )
);
COMMENT ON TABLE private.personal_data_purge_journal IS
    'Run-scoped aggregate purge checkpoints only; no user IDs, review content, object paths, or credentials.';
ALTER TABLE private.personal_data_purge_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.personal_data_purge_journal FROM PUBLIC, anon, authenticated, service_role;

-- Check existing UUID-based MENU keys before making former-uploader attribution nullable.
-- The Storage path and bytes remain intact, including paths with former uploader UUIDs.
DO $menu_media_path_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.media_assets AS a
        WHERE a.media_kind = 'MENU'
          AND (a.uploaded_by IS NULL
            OR a.object_path <> 'menu/' || a.uploaded_by::text || '/' || a.id::text ||
                CASE a.content_type
                    WHEN 'image/jpeg' THEN '.jpg'
                    WHEN 'image/png' THEN '.png'
                    ELSE '.webp'
                END)
    ) THEN
        RAISE EXCEPTION '20260928120000 aborted: an existing MENU object path is not unchanged';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.menus AS m
        JOIN public.media_assets AS a ON a.id = m.photo_media_id
        WHERE a.media_kind <> 'MENU' OR a.menu_id IS DISTINCT FROM m.id
    ) THEN
        RAISE EXCEPTION '20260928120000 aborted: a MENU photo association has an unexpected target';
    END IF;
END
$menu_media_path_guard$;

ALTER TABLE public.media_assets
    ALTER COLUMN uploaded_by DROP NOT NULL;
COMMENT ON COLUMN public.media_assets.uploaded_by IS
    'Nullable only so the approved final identity purge can retain MENU media without former-user attribution.';

-- Stop requiring or exposing the legacy review field before its later post-deploy drop.
DROP POLICY IF EXISTS reviews_self_insert ON public.reviews;
CREATE POLICY reviews_self_insert ON public.reviews
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.menus AS m
            WHERE m.id = reviews.menu_id AND m.active = true
        )
    );

DROP POLICY IF EXISTS reviews_self_update ON public.reviews;
CREATE POLICY reviews_self_update ON public.reviews
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.menus AS m
            WHERE m.id = reviews.menu_id AND m.active = true
        )
    );

REVOKE SELECT ON public.reviews FROM anon, authenticated;
GRANT SELECT (id, user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, created_at, updated_at)
    ON public.reviews TO anon, authenticated;

REVOKE INSERT (user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent)
    ON public.reviews FROM authenticated;
REVOKE UPDATE (overall_score, taste_score, value_score, portion_score, comment, non_event_review_consent)
    ON public.reviews FROM authenticated;
GRANT INSERT (user_id, menu_id, overall_score, taste_score, value_score, portion_score, comment)
    ON public.reviews TO authenticated;
GRANT UPDATE (overall_score, taste_score, value_score, portion_score, comment)
    ON public.reviews TO authenticated;
