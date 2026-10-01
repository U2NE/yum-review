-- The legacy application is deployed independently. Keep this migration
-- pending until that target is confirmed healthy and no longer references the
-- consent field. No CASCADE: unexpected dependencies must stop Flyway.
ALTER TABLE review
    DROP COLUMN IF EXISTS non_event_review_consent;
