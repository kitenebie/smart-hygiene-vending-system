# PHP → React parity audit

Current source checked: 2026-11-13. `Php_Version` is the reference; no PHP source was edited during this audit.

## Current PHP files

- `index.php`
- `api/credit_reset.php`, `api/settings_get.php`, `api/settings_save.php`
- `assets/css/style.css`, `assets/js/app.js`
- `includes/functions.php`, `includes/supabase_sync.php`
- `4peace_db.sql` (phpMyAdmin dump generated 2026-11-12)

The previous `4peace.sql` dump was replaced by `4peace_db.sql`. Both describe the same 15 tables. Compared with the previous dump, the current schema adds `gcash_payments.Notes` and `machine_settings.wifi_ssid`, `wifi_password`, and `credit_reset_token`. The latter is `INT NOT NULL DEFAULT 0`. The SQL data snapshot was refreshed; exact row-by-row data deltas have not been calculated.

## Latest PHP changes

1. `index.php` adds “Reset coin balance” actions on Device Health and Settings, plus a current-credit status label in Settings.
2. `assets/js/app.js` loads reset status on Health/Settings, displays the latest credit parsed from ESP32 logs, confirms the reset, and posts to `api/credit_reset.php`.
3. New `api/credit_reset.php` returns `credit_reset_token` and latest reported credit on GET. POST increments the token in Supabase and local MySQL, then records a notification.
4. New `includes/functions.php` provides shared helpers, adds/reads `credit_reset_token`, and parses recent credit from `esp32_logs`.
5. `includes/supabase_sync.php` syncs `credit_reset_token` and creates the local MySQL column when needed.
6. `api/settings_get.php` and `api/settings_save.php` handle the existing Wi-Fi settings behavior.

## PHP ↔ React status

React has equivalents for all eight PHP dashboard views: Overview, Slots, Transactions, Device Health, Notifications, SMS Logs, ESP32 Logs, and Settings. Wi-Fi SSID/password controls are already implemented in React with the `20261103005000_machine_wifi_settings.sql` migration.

The newly added coin-balance reset UI/status is not present in React. No Supabase migration currently defines `machine_settings.credit_reset_token`, and the current firmware contains no consumer for that token; the PHP notice alone does not prove the physical reset works.

The SQL dump has a `Notes` column on `gcash_payments`, but neither the current PHP UI JavaScript nor React renders/uses it. Preserve it in the data model if its values matter; no frontend behavior is evidenced.

React login currently requires email, per the latest request. The PHP settings text calls username the login name, but the PHP login/auth implementation is absent, so exact login parity cannot be verified.

## PHP source gaps

`app.js` references 21 distinct API endpoints. Only `credit_reset.php`, `settings_get.php`, and `settings_save.php` exist; 18 endpoint implementations are missing. The missing files are `esp32_logs.php`, `gcash_approve.php`, `gcash_pending.php`, `health.php`, `notifications_read.php`, `notifications.php`, `overview.php`, `pin_assign.php`, `pin_detection.php`, `pin_device_create.php`, `pin_status.php`, `profile_save.php`, `slot_restock.php`, `slots_save.php`, `slots.php`, `sms_logs.php`, `supabase_sync.php`, and `transactions.php`.

The supplied PHP tree also lacks `includes/auth_check.php`, `config/db.php`, and `logout.php`, all referenced by the dashboard/API flow. Therefore the PHP app cannot currently run end-to-end under XAMPP, and the missing server validation/authorization rules cannot be checked against the React implementation.

## Data/import status

The existing generated `supabase/ONE_TIME_SETUP.sql` and import generator were built from the earlier XAMPP snapshot. They have not been regenerated from the new `4peace_db.sql`; they do not yet prove the current dump’s schema/data is represented in Supabase. The destructive `002_mock_data.sql` must stay excluded.
