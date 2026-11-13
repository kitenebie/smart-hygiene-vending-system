# Plan to match `Php_Version` and the React website

Reference snapshot: `Php_Version/4peace_db.sql` generated 2026-11-12, plus the current PHP/JS/CSS files. React keeps email-only login as requested.

## Work completed in this audit

- Listed the current PHP files and source changes in `MIGRATION_AUDIT.md`.
- Compared all 15 MySQL table schemas against the previous dump.
- Mapped modules to React views and recorded the missing PHP source/backend files.
- Verified `npm run build` after the email-only login adjustment.

## Implementation order

1. **Refresh the canonical DB import.** Import the current `4peace_db.sql` into a separate XAMPP staging database, leaving `4peace_db` and the prior comparison snapshot untouched. Regenerate the PostgreSQL data SQL and `ONE_TIME_SETUP.sql` from this dump; convert MySQL booleans correctly, preserve IDs/relationships, and exclude `002_mock_data.sql`.
2. **Add the schema delta.** Create an additive Supabase migration for `machine_settings.credit_reset_token` (`integer not null default 0`) and `gcash_payments.Notes` if retaining that source data. Keep existing Wi-Fi columns/migration. Apply against staging and compare table/row counts before any production import.
3. **Implement coin-balance reset in React.** Add the matching status and reset actions to Device Health and Settings. Read latest reported credit from `esp32_logs`; send a reset request through an authenticated Supabase operation; update notifications and show request/result state. Do not expose a service-role key in the browser.
4. **Make the physical reset real.** Add firmware settings-poll handling for `credit_reset_token`: detect a new token, set persisted `currentCredit` to zero, refresh the display, and log acknowledgement. Current firmware has no reference to this token, so the PHP UI’s “reset sent” message is not proof that hardware currently resets.
5. **Finish module-by-module parity.** Compare PHP markup/styles and each recovered JS action to its React view. Existing mappings: Overview, Slots, Transactions/GCash, Health, Notifications, SMS Logs, ESP32 Logs, Settings, PIN diagnostics, and CSV export. Keep `gcash_payments.Notes` data-only unless its intended behavior is discovered.
6. **Resolve unavailable PHP behavior from evidence.** The current PHP JS calls 21 APIs, but only 3 API files exist. The other 18 endpoint implementations and `auth_check.php`, `config/db.php`, `logout.php` are missing. Use the SQL, current React behavior, and firmware as evidence; mark any inferred business rule rather than presenting it as verified PHP parity.
7. **Verify in staging.** Apply schema/data there, confirm row counts and foreign keys, test the reset end-to-end with firmware, then compare each React screen against the PHP markup at desktop/mobile sizes. Only after this evidence is clean should the consolidated setup be refreshed for user application.

## Current blockers and decisions

- Live Supabase schema/records are not connected here, so migrations/import have not been applied or checked against the remote project.
- PHP cannot currently run because required auth/database files are absent; pixel/behavior comparison against a running PHP app is unavailable.
- React login remains email-only per the latest direction, even though the PHP Settings hint says username is used to log in; the actual PHP login implementation is missing.
- The React auth profile migration requires a Supabase Auth user linked to `public.profiles` before dashboard login succeeds.
