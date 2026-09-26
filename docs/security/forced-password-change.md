# Legacy forced password change

The private legacy password marker is cleared only by the server's `/api/account/legacy-password-change` route. The route requires a valid signed-in session, independently verifies the supplied current password, rejects a new password equal to the current password, updates Auth, and then uses a server-only Supabase key to call a narrowly scoped RPC for the authenticated user's ID. The RPC is executable only by `service_role`.

Direct `auth.updateUser({ password })` calls do not clear the marker. The Auth hash-update trigger has been removed by an append-only migration, so changing Auth state through another client cannot unlock the application. Existing table and Storage write gates continue to reject writes while the private marker is set. If the password update succeeds but the private clear step fails, the account stays gated; retry using the new current password and choose another new password after the server configuration is repaired.

Apply the migration before enabling this flow in an environment with legacy users. Keep the Supabase secret key server-only. Local, Preview, and Production must use their own isolated Supabase projects and environment variables; never use the Production project for Preview or local QA.
