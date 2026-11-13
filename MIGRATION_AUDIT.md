# PHP → React parity audit

Current source checked: 2026-11-13. `Php_Version` is the reference; no PHP source was edited during this audit.

## Current PHP files

- `index.php`
- `api/credit_reset.php`, `api/settings_get.php`, `api/settings_save.php`
- `assets/css/style.css`, `assets/js/app.js`
- `includes/functions.php`, `includes/supabase_sync.php`
- `4peace_db.sql` (phpMyAdmin dump generated 2026-11-12)

The previous `4peace.sql` dump was replaced by `4peace_db.sql`. Both describe the same 15 tables. The Nov 12 dump adds `gcash_payments.Notes` and `machine_settings.wifi_ssid`, `wifi_password`, and `credit_reset_token`. It was imported into isolated XAMPP staging database `4peace_legacy_staging_20261113`; table counts and generated SQL are recorded in `TEST_CHECKLIST.md`. The original database was left untouched.

## Latest PHP changes

1. `index.php` adds “Reset coin balance” actions on Device Health and Settings, plus a current-credit status label in Settings.
2. `assets/js/app.js` loads reset status on Health/Settings, displays the latest credit parsed from ESP32 logs, confirms the reset, and posts to `api/credit_reset.php`.
3. New `api/credit_reset.php` returns `credit_reset_token` and latest reported credit on GET. POST increments the token in Supabase and local MySQL, then records a notification.
4. New `includes/functions.php` provides shared helpers, adds/reads `credit_reset_token`, and parses recent credit from `esp32_logs`.
5. `includes/supabase_sync.php` syncs `credit_reset_token` and creates the local MySQL column when needed.
6. `api/settings_get.php` and `api/settings_save.php` handle the existing Wi-Fi settings behavior.

## PHP ↔ React status

React has equivalents for all eight dashboard views and uses React Router query parameters for the active view. Wi-Fi settings and the latest PHP coin-balance reset flow now have React/Supabase equivalents. The reset schema/RPC passed an isolated PostgreSQL test and the firmware token path passed static checks, but neither has been applied/verified against the linked Supabase project or physical ESP32.

The SQL dump has a `Notes` column on `gcash_payments`, but neither the current PHP UI JavaScript nor React renders/uses it. Preserve it in the data model if its values matter; no frontend behavior is evidenced.

React login currently requires email, per the latest request. The PHP settings text calls username the login name, but the PHP login/auth implementation is absent, so exact login parity cannot be verified.

## PHP source gaps

`app.js` references 21 distinct API endpoints. Only `credit_reset.php`, `settings_get.php`, and `settings_save.php` exist; 18 endpoint implementations are missing. The missing files are `esp32_logs.php`, `gcash_approve.php`, `gcash_pending.php`, `health.php`, `notifications_read.php`, `notifications.php`, `overview.php`, `pin_assign.php`, `pin_detection.php`, `pin_device_create.php`, `pin_status.php`, `profile_save.php`, `slot_restock.php`, `slots_save.php`, `slots.php`, `sms_logs.php`, `supabase_sync.php`, and `transactions.php`.

The supplied PHP tree also lacks `includes/auth_check.php`, `config/db.php`, and `logout.php`, all referenced by the dashboard/API flow. Therefore the PHP app cannot currently run end-to-end under XAMPP, and the missing server validation/authorization rules cannot be checked against the React implementation.

## Data/import status and remaining gaps

The import generator and `supabase/ONE_TIME_SETUP.sql` now use the isolated Nov 12 dump, preserve IDs, convert booleans, exclude demo seeds/the superseded dump, and use `ON CONFLICT DO NOTHING`. The full bundle passed on fresh local PostgreSQL 17 with minimal Supabase Auth/Realtime fixtures and the 15 source-table counts matched. The actual React `loadReportedCoinBalance()` helper returned a finite value from live Supabase. Read-only live checks confirm `machine_settings.credit_reset_token` and `gcash_payments.Notes` are absent; the reset RPC cannot run on the live schema until migrations are applied. The legacy migration set disables RLS on multiple app tables, so the bundle is development/staging only until table access policies are reviewed and implemented.

The React project currently uses TypeScript/TSX although the migration brief requested JavaScript/JSX. The linked Supabase account returned HTTP 403 for migration listing, while read-only API access is available; no remote schema or data was changed. Anonymous `select=*&limit=0` requests returned HTTP 200 for 15 app tables, confirming the live legacy RLS gap; `admins` returned 401 and `profiles` was filtered. PHP cannot run end-to-end because its auth/database/logout dependencies are absent. The remaining PHP backend behavior and visual parity therefore cannot be verified exactly.
