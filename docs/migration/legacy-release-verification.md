# Legacy release verification — G8 blocked

**Status: BLOCKED / NOT RUN.** The hosted schema apply failed with SQLSTATE `P0001` before deployment. This task did not deploy the legacy application, run its migration mechanism, drop the legacy consent column, or reconcile legacy account/review records.

No legacy account or review data was deleted. The separate legacy release and purge gates remain outstanding and must be completed under their own authorized scope. No legacy readiness, compatibility, or data-preservation claim is made by this document.
