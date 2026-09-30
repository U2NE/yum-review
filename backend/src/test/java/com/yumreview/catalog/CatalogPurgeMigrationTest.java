package com.yumreview.catalog;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CatalogPurgeMigrationTest {
    private static final String MIGRATION = "/db/migration/V7__purge_journal_and_menu_media_attribution.sql";

    @Test
    void createsPrivateAggregateJournalAndMakesOnlyAttributionNullable() throws IOException {
        String sql = migration().toLowerCase();

        assertTrue(sql.contains("create table private.personal_data_purge_journal"));
        assertTrue(sql.contains("'supabase-review-storage'"));
        assertTrue(sql.contains("'legacy-db'"));
        assertTrue(sql.contains("retained_menu_path_hmac"));
        assertTrue(sql.contains("retained_menu_bytes_hmac"));
        assertTrue(sql.contains("alter column uploaded_by_user_id drop not null"));
        assertTrue(sql.contains("alter column rights_attested_by_user_id drop not null"));
        assertTrue(sql.contains("menu_media_path_guard"));
        assertTrue(sql.contains("lower(a.storage_key) <> 'menu-' || lower(a.media_id) || '.webp'"));
    }

    @Test
    void neverRewritesCatalogRowsOrDeletesMenuMedia() throws IOException {
        String sql = migration().toLowerCase();

        assertFalse(sql.matches("(?s).*\\b(delete|update|insert|truncate)\\s+(public\\.)?(restaurant|menu|media_asset)\\b.*"));
        assertFalse(sql.contains("storage.objects"));
        assertFalse(sql.contains("drop column non_event_review_consent"));
    }

    private static String migration() throws IOException {
        try (InputStream stream = CatalogPurgeMigrationTest.class.getResourceAsStream(MIGRATION)) {
            if (stream == null) throw new IOException("V7 migration resource is missing");
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
