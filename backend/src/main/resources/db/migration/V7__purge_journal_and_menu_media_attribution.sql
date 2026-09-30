-- Additive purge bookkeeping and identity attribution cleanup support.
-- This migration never changes catalog rows, image keys, or stored image bytes.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

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
REVOKE ALL ON TABLE private.personal_data_purge_journal FROM PUBLIC;

-- Check existing MENU keys before making former-uploader attribution nullable.
-- Retained keys include the original UUID locator and are intentionally not rewritten.
DO $menu_media_path_guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM menu AS m
        JOIN media_asset AS a ON a.media_id = m.photo_media_id
        WHERE a.storage_key !~* '^menu-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
           OR lower(a.storage_key) <> 'menu-' || lower(a.media_id) || '.webp'
    ) THEN
        RAISE EXCEPTION 'V7 aborted: an existing MENU media key is not an unchanged UUID-based key';
    END IF;
END
$menu_media_path_guard$;

ALTER TABLE media_asset
    ALTER COLUMN uploaded_by_user_id DROP NOT NULL,
    ALTER COLUMN rights_attested_by_user_id DROP NOT NULL;

COMMENT ON COLUMN media_asset.uploaded_by_user_id IS
    'Nullable only so the approved final identity purge can retain MENU media without former-user attribution.';
COMMENT ON COLUMN media_asset.rights_attested_by_user_id IS
    'Nullable only so the approved final identity purge can retain MENU media without former-user attribution.';
