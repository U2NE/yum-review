BEGIN;

SELECT plan(10);

SELECT has_table('private', 'personal_data_purge_journal', 'purge checkpoints use a private table');
SELECT ok(
    NOT has_table_privilege('anon', 'private.personal_data_purge_journal', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'private.personal_data_purge_journal', 'INSERT')
    AND NOT has_table_privilege('service_role', 'private.personal_data_purge_journal', 'UPDATE'),
    'purge checkpoint table is not available through client or service roles'
);
SELECT col_is_null('public', 'media_assets', 'uploaded_by', 'menu uploader attribution can be nulled after freeze');
SELECT has_column('public', 'reviews', 'non_event_review_consent', 'consent column stays through coordinated rollout');
SELECT ok(
    NOT has_column_privilege('anon', 'public.reviews', 'non_event_review_consent', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'public.reviews', 'non_event_review_consent', 'SELECT'),
    'client roles cannot read the legacy review consent column'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.reviews', 'non_event_review_consent', 'INSERT'),
    'client role cannot insert the legacy review consent column'
);
SELECT ok(
    NOT has_column_privilege('authenticated', 'public.reviews', 'non_event_review_consent', 'UPDATE'),
    'client role cannot update the legacy review consent column'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'reviews'
          AND policyname IN ('reviews_self_insert', 'reviews_self_update')
          AND (coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%non_event_review_consent%'
    ),
    'review write policies no longer depend on consent'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM public.media_assets AS a
        WHERE a.media_kind = 'MENU'
          AND (a.uploaded_by IS NULL
            OR a.object_path <> 'menu/' || a.uploaded_by::text || '/' || a.id::text ||
                CASE a.content_type
                    WHEN 'image/jpeg' THEN '.jpg'
                    WHEN 'image/png' THEN '.png'
                    ELSE '.webp'
                END)
    ),
    'retained MENU object paths still match their original UUID-based form'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM public.menus AS m
        JOIN public.media_assets AS a ON a.id = m.photo_media_id
        WHERE a.media_kind <> 'MENU' OR a.menu_id IS DISTINCT FROM m.id
    ),
    'every retained menu photo still points to its original MENU asset'
);

SELECT * FROM finish();
ROLLBACK;
