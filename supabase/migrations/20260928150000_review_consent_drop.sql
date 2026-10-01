-- Drop the retired consent field only after the deployed application no longer
-- reads or writes it. Intentionally omit CASCADE so unexpected dependencies
-- stop the migration rather than being removed implicitly.
ALTER TABLE public.reviews
    DROP COLUMN IF EXISTS non_event_review_consent;
