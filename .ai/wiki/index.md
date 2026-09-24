---
title: Project Wiki
category: index
tags: [index]
---
# Project Wiki

Derived knowledge projection. Canonical state is under `.planning/`.

## Local runtime

The live MVP was verified on 2026-09-25 with PostgreSQL in WSL Ubuntu. Flyway migrations, menu loading, signup/login, review create/update/delete, and menu rating aggregation succeeded. See [README](../../README.md) for Docker and WSL database setup and the API port override.

Manual browser QA on 2026-09-25 exercised search submission and both clear-search states, quick-search buttons, recommendation/rating sort, menu and restaurant links, public reviews while logged out, signup/login validation and redirects, review create/edit/cancel/delete, rating recalculation, and logout. Search clearing now resets the query URL as well as the visible results. Public menu reviews are accessible to guests and their timestamps map correctly from PostgreSQL. The price formatter is outside the React page module, avoiding a development Fast Refresh warning. The temporary UI-QA review and account were removed after deletion was verified; pre-existing data was preserved. Frontend production build passes.
