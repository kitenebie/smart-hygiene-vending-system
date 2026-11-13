# Migration and feature test checklist — 2026-11-13

## Tested

- [x] Imported the Nov 12 PHP dump into isolated XAMPP staging database `4peace_legacy_staging_20261113`; the original `4peace_db` was left untouched.
- [x] Generated PostgreSQL data SQL for all 15 source tables and checked the row counts against staging: 1 admin, 1 device-health row, 737 resource samples, 4,879 ESP32 logs, 8 pin devices, 19 pin assignments, 34 pin statuses, 13 GCash payments, 51 health logs, 1 settings row, 60 notifications, 449 SMS rows, 5 sync-state rows, 5 slots, and 467 transactions.
- [x] Regenerated `ONE_TIME_SETUP.sql`; confirmed it excludes demo seeds and the superseded Nov 3 import and contains no `DROP TABLE` or `TRUNCATE TABLE` statements. Imports use `ON CONFLICT DO NOTHING`.
- [x] `npm run build` — passed again (TypeScript and Vite; 98 modules). Main JS bundle is 1,472.33 kB (419.82 kB gzip), above Vite's 500 kB warning threshold.
- [x] Direct Oxlint run — 0 errors, 5 warnings. Warnings are in dashboard/auth/toast code, the Settings effect dependency, and legacy PHP JS. The `npm run lint` wrapper returned an output-parser error; direct Oxlint gave its normal result.
- [x] `npm run test:coin-reset` — passed PHP/React regex parity, PHP-dump-shaped credit messages, latest-log query ordering, admin-only UI/RPC checks, database locking, notification creation, firmware token persistence, and checks that the one-file setup includes the reset column/RPC without destructive SQL.
- [x] `npm run test:coin-reset-db` — disposable PostgreSQL integration passed: admin reset incremented token 7→8 and created one notification; technician and anon calls were denied and left token/notification state unchanged.
- [x] `npm run test:profile-role-boundary` — disposable PostgreSQL test passed: new Auth profiles default to `Machine Technician`, self-promotion is denied even after seeding a legacy column-level `role` grant, allowed profile edits still work, and existing roles are preserved.
- [x] Settings PHP/React source parity review — both pages include product/slot editing, admin profile, last-login/role display, machine settings, Wi-Fi, PIN detection, and coin reset; React handlers are wired to Supabase. This is structural review only, not an authenticated-save or pixel-level visual test.
- [x] Settings profile email source audit — `profiles` has no email column, so React now loads the field from the authenticated Supabase user context. Build passed after the fix; actual authenticated email change/confirmation remains unverified.
- [x] Dev-server check — after setting Vite's default to `127.0.0.1:4173`, the exact `npm run dev` command started successfully and `/`, `/login`, and `/?view=health` returned HTTP 200. The previous default port 5173 had failed with `EACCES`.
- [x] `npm run firmware:check` — live schema endpoints responded, but `complete_vend` rejected the configured test device key (`invalid device key`) before the expected nonexistent-slot check; no sale was created. The later telemetry and pin RPC probes did not run after the assertion failed.
- [x] Applied the schema delta and reset RPC to a disposable local PostgreSQL 17 database. Admin incremented the token and created a notification; technician and `anon` calls were denied; rejected calls did not change token/notification state.
- [x] Applied the complete `ONE_TIME_SETUP.sql` to a fresh disposable PostgreSQL 17 database with minimal Supabase Auth and Realtime fixtures; all 15 imported table counts, boolean schema, and reset token value matched expectations.
- [x] Playwright local browser rerun — `/login` rendered; email is required and `type=email`; malformed email returned `typeMismatch=true` and Enter did not submit; unauthenticated `/?view=health` redirected to `/login`; 0 browser errors/warnings.
- [x] Live domain `https://4peacesystem.earms.site/` — HTTP 200; root redirects to `/login`; deployed JS asset is byte-for-byte/SHA-256 identical to local build (1,472,337 bytes) and contains the reset button and `request_coin_balance_reset` call.
- [x] Live-domain Playwright — email/password required, malformed email returned `typeMismatch=true` and did not submit, `/?view=health` redirected to `/login`, and browser reported 0 errors/warnings.
- [x] Read-only live Supabase credit query — HTTP 200 and latest credit message matched the PHP-equivalent parser; message contents were withheld.
- [x] Imported the actual React `loadReportedCoinBalance()` helper in the local Vite browser; it returned a finite value from live Supabase. The balance itself was not printed.
- [x] Live schema recheck via the deployed app's Supabase URL — `machine_settings.credit_reset_token` and `gcash_payments.Notes` now both return HTTP 200 for `select=<column>&limit=0`. No rows were fetched; migration provenance and imported row counts remain unverified. A previous check returned `42703`.
- [x] Live reset RPC authorization probe — anonymous POST returned HTTP 401 / PostgreSQL `42501`; no successful reset was requested.
- [x] Read-only Supabase Auth settings probe — HTTP 200 reports public signup enabled. No signup was created; whether the role-hardening migration is active remotely could not be confirmed.
- [x] Anonymous table-access probe (`select=*&limit=0`) — `slots`, `transactions`, `device_health`, `machine_health_logs`, `machine_settings`, `gcash_payments`, `notifications`, `sms`, `esp32_logs`, `device_resource_logs`, `esp32_pin_status`, `esp32_pin_devices`, `esp32_pin_device_assignments`, `supabase_sync_state`, and `esp32_device_presence` returned HTTP 200. `admins` returned 401 and `profiles` was row-filtered. No row data was requested; legacy migrations disable RLS on several of these tables.
- [x] Firmware permission dependency audit — firmware uses its publishable/anon key for direct `machine_settings`/`slots`/`sms` reads, GCash payment operations, health/notification/SMS writes, and several RPCs. Those calls must be preserved behind device-key-validated RPCs (or equivalent trusted access) before restrictive RLS is enabled; a blanket RLS change would break device workflows.

## Not tested or blocked

- [ ] Supabase SQL migrations/data import — not applied by this audit. `supabase migration list --linked` returned HTTP 403. The live API now recognizes both new columns, but migration history, full schema, imported row counts, and data integrity were not verified. No remote schema or records were changed by these checks.
- [ ] Reset RPC with a real Supabase administrator session — still unverified. The anonymous call was denied with 401/42501; no admin session was available to verify a successful call.
- [ ] Audit existing `profiles.role` values before deploying the role-boundary migration. The migration preserves existing roles; it does not demote accounts that may have been created under the old Administrator default.
- [ ] Confirm live role hardening before allowing public signup. The local profile trigger's old default is `Administrator`; if still active on the live project, public signup could create a dashboard-admin profile. No signup or role mutation was attempted.
- [ ] Authenticated dashboard pages and reset buttons — no authenticated test session was established in the isolated Playwright browser, so the admin UI action remains untested.
- [ ] Login backend parity — current React login uses Supabase Auth/`profiles`, while the user's instruction requested the legacy `admins` table. That requested path is not implemented or tested; legacy password hashes cannot be copied into Auth as passwords.
- [ ] Firmware end-to-end — `npm run firmware:check` reached the live project but rejected the configured test device key at the vend RPC check; it did not create a sale. Arduino compiler and physical machine were unavailable.
- [ ] PHP/React visual comparison — blocked because PHP runtime dependencies `includes/auth_check.php`, `config/db.php`, and `logout.php` are missing.
- [ ] Full module/role/RLS verification — not complete. Anonymous requests can query exposed table schemas, public Auth signup is enabled, and legacy migrations disable RLS on app tables. Actual row data was not fetched. Verify the role-boundary migration and review grants; move firmware direct REST writes behind device-key-validated RPCs before enabling restrictive RLS. The setup file remains development/staging only until policies are implemented and verified.

## Module-by-module coverage

| Module | Verified | Still needs testing |
|---|---|---|
| Login/Auth | Local + live-domain required email/password fields, malformed-email browser validation, unauthenticated redirect, and local PostgreSQL role-boundary regression | Resolve `admins` table vs Supabase Auth requirement; then test real sign-in, logout, password update/reset, existing-role audit, and live role-based access |
| Overview/Dashboard | TypeScript/Vite build | Authenticated live totals, filters, realtime refresh, and role permissions |
| Slots/Inventory | TypeScript/Vite build | Stock restock RPC, validation, permissions, and live updates |
| Transactions/GCash | TypeScript/Vite build | Approve/reject, notification side effects, search/filter, and CSV export against staging |
| Device Health/Coin reset | Live bundle contains reset UI/RPC call; live schema recognizes reset column; anonymous RPC is denied; parser/helper checks, local PostgreSQL RPC and profile-role tests, firmware token persistence static check, and live read-only reported balance | Authenticated admin UI confirmation flow, successful live admin RPC, existing role audit, firmware acknowledgement on hardware |
| Notifications | TypeScript/Vite build | Mark-read/all-read, unread count, realtime refresh, and permission checks |
| SMS Logs | TypeScript/Vite build | Search/filter/pagination and live SMS data access |
| ESP32 Logs | TypeScript/Vite build | Filters, pagination, live query permissions, and realtime behavior |
| Settings/Profile/PIN diagnostics | PHP/React source structure comparison; TypeScript/Vite build | Authenticated settings/profile writes, password/email change, PIN RPC authorization, and pixel-level visual parity |
| CSV export | TypeScript/Vite build | Exported rows, formatting, and filtering parity |

The build confirms these modules compile; it does not count as an end-to-end module test. No authenticated React test session was confirmed for the pending checks.

## Plan verdict

**Not complete.** The dump conversion and local coin-reset UI/RPC/firmware code are implemented, but remote migration, authorization/RLS, firmware hardware behavior, visual parity, and PHP operations whose source is missing remain unverified or incomplete.

### Full-plan status

- [x] PHP inventory, database mapping, route mapping, and module checklist exist; eight dashboard views have React counterparts and React Router is present.
- [x] Supabase migration/data bundle is generated locally from the latest dump.
- [ ] Apply and verify schema/data in authorized Supabase staging; direct API reads work, but linked CLI/SQL access returns HTTP 403.
- [ ] Finish table-level RLS policies and verify role permissions; multiple legacy migrations leave app tables with RLS disabled.
- [ ] Resolve the requested `admins`-table login vs current Supabase Auth/`profiles` flow, then complete safe legacy account linking/reset. Imported PHP password hashes are not Supabase Auth credentials.
- [ ] Verify every module end-to-end and compare the live PHP UI; 18 PHP API implementations and PHP auth/database files are missing.
- [ ] Match the requested JavaScript/JSX stack; current React source is TypeScript/TSX.
- [ ] Verify physical coin reset on firmware/hardware; compiler and machine are unavailable.

| Original phase | Status | Verification result |
|---|---|---|
| 1. PHP source audit | Partial | Existing files and missing APIs are inventoried; missing auth/database/API files prevent verifying their server rules. |
| 2. Supabase schema/data | Partial | Full bundle passes locally; live API recognizes `credit_reset_token` and `Notes`, but import history/counts and RLS remain unverified. |
| 3. React frontend | Partial | Eight views and React Router exist; full module behavior and visual parity are not verified. Source is TSX, not requested JSX. |
| 4. Supabase backend | Partial | Direct reads work; live API recognizes reset fields and denies anonymous RPC calls; successful admin RPC remains unverified. |
| 5. Auth/authorization | Partial | Local migration blocks new self-promotion; public signup is enabled, existing profile roles/live migration state are unverified, and the `admins` vs Auth login requirement is unresolved. |
| 6. Module implementation | Partial | React equivalents are mapped; 18 PHP API implementations are missing and all CRUD paths are not end-to-end tested. |
| 7. Project structure | Partial | Existing project structure is usable; the requested JavaScript/JSX conversion is not done. |
| 8. Testing | Partial | Build, static, local PostgreSQL role/RPC, and live-domain login checks pass; live admin reset and hardware checks remain. |
| 9. Delivery/completion | Not complete | Remote migration and full behavior verification remain; no 100% completion claim is supported. |
