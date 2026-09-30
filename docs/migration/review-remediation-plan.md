# Review consent and retained media migration

## Review consent

The review form no longer asks whether a review was written without an event or compensation. Both application APIs, the Spring DTO/entity/service, and the migration export/import/verifier omit the field. Spring exports use format `yum-review.spring-export/v2`; artifacts from the older consent-bearing format are rejected rather than silently carrying the field forward.

The Supabase additive migration removes the consent condition from review insert/update policies and stops granting client roles access to the legacy column. The database column remains during the coordinated rollout so the currently deployed application can be drained safely. Do not add a default, backfill, or infer historical consent. The final Supabase and Flyway column drops belong only to the separate post-deployment task, after both applications are healthy and verified not to read or write the field.

The account review page's remaining legacy select is assigned to the UI redesign executor and must be removed there before rollout. This document records that cross-task dependency; it does not change that page.

## Additive purge support and menu media

The Supabase and Flyway migrations create private per-target purge checkpoint tables containing only the run identifier, fixed target, state, aggregate counts, timestamps, and keyed opaque MENU path/byte digests. The tables have no client grants. They contain no account IDs, review content, raw storage paths, or credentials.

Before making uploader attribution nullable, each migration validates existing MENU media key/path structure. The migration changes only the nullable constraint on uploader and rights-attestor references. It does not update restaurants, menus, media rows, paths, or Storage/filesystem bytes. The legacy UUID segment in a retained Supabase menu path is an approved residual locator; evidence must contain only the keyed opaque digest.

These additive migrations do not delete accounts, reviews, media, catalog rows, or objects, and do not drop review consent columns. Apply them only through the approved release task after its local checks and exact migration preflight.
