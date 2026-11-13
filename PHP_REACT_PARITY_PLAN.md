# Plan to match `Php_Version` and the React website

Reference snapshot: `Php_Version/4peace_db.sql` generated 2026-11-12, plus the current PHP/JS/CSS files. React keeps email-only login as requested.

## Backend rule

The React website uses Supabase as its only runtime backend: Supabase Auth, PostgreSQL/Data API, RPCs, Realtime, and Storage where needed. XAMPP/MySQL is only a source for importing and converting the legacy dump; React must not connect to MySQL or depend on PHP endpoints. Translate each required PHP operation into a Supabase query, PostgreSQL function, or Edge Function when trusted server-side work is needed.

## Work completed in this audit

- Listed the current PHP files and source changes in `MIGRATION_AUDIT.md`.
- Compared all 15 MySQL table schemas against the previous dump.
- Mapped modules to React views and recorded the missing PHP source/backend files.
- Verified `npm run build` after the email-only login adjustment.

## Implementation order

1. **Refresh the canonical DB import — implemented and locally verified.** Imported the Nov 12 dump into the separate XAMPP staging database `4peace_legacy_staging_20261113`, leaving the original and comparison database untouched. Generated a type-converted, conflict-safe import migration and one-file SQL setup without demo seeds or the superseded Nov 3 import; the full setup ran against isolated PostgreSQL 17 and passed all 15 table-count checks.
2. **Add the schema delta — implemented and locally verified.** Added `Notes`, Wi-Fi fields, and `credit_reset_token bigint not null default 0` through idempotent additive SQL; the RPC migrations passed local PostgreSQL role/locking/notification checks. The live API now recognizes `Notes` and `credit_reset_token`, and an anonymous call to the reset RPC is denied. The linked CLI account still returns HTTP 403, so migration history, full import counts, and successful admin invocation remain unverified.
3. **Implement coin-balance reset in React — implemented locally.** Device Health and Settings read the last reported ESP32 credit and expose an administrator-only reset action. The action calls an authenticated Supabase RPC that increments the token and inserts a notification.
4. **Make the physical reset real — implemented locally, hardware verification pending.** Firmware detects a higher token during the idle settings poll, persists zero credit and the handled token, updates the display, and logs acknowledgement. No Arduino compiler or hardware is available here; the live firmware API check also stopped at an existing device-token mismatch before any sale was recorded.
5. **Finish module-by-module parity.** Compare PHP markup/styles and each recovered JS action to its React view. Existing mappings: Overview, Slots, Transactions/GCash, Health, Notifications, SMS Logs, ESP32 Logs, Settings, PIN diagnostics, and CSV export. Keep `gcash_payments.Notes` data-only unless its intended behavior is discovered.
6. **Resolve unavailable PHP behavior from evidence.** The current PHP JS calls 21 APIs, but only 3 API files exist. The other 18 endpoint implementations and `auth_check.php`, `config/db.php`, `logout.php` are missing. Use the SQL, current React behavior, and firmware as evidence; implement required behavior directly through Supabase queries/RPCs/Edge Functions, and mark any inferred business rule rather than presenting it as verified PHP parity.
7. **Verify in staging.** Remaining: apply schema/data through an authorized Supabase account, confirm remote row counts and foreign keys, test the reset end-to-end with firmware, then compare each React screen against the PHP markup at desktop/mobile sizes.
8. **Close profile-role escalation.** Added an additive migration that makes new profiles `Machine Technician` by default and only grants authenticated users updates to username, name, phone, and last-login fields. Disposable PostgreSQL regression passed; existing profile roles remain unchanged and must be audited before rollout.

## Current blockers and decisions

- `supabase migration list --linked` was denied by Supabase with HTTP 403 (account lacks endpoint access). Current read-only API probes recognize `credit_reset_token` and `Notes`; an anonymous reset RPC call is denied with 401/42501. No remote migrations or rows were changed by this audit. The generated import is additive; existing rows with matching IDs are kept and not overwritten.
- Anonymous schema-only reads (limit 0) were accepted by 15 app table endpoints; `admins` is rejected and `profiles` is row-filtered. No row data was requested. This confirms table-level RLS/permissions remain incomplete on the live project.
- PHP cannot currently run because required auth/database files are absent; pixel/behavior comparison against a running PHP app is unavailable.
- React login remains email-only per the latest direction, even though the PHP Settings hint says username is used to log in; the actual PHP login implementation is missing.
- The React auth profile migration requires a Supabase Auth user linked to `public.profiles` before dashboard login succeeds.
- The current React login calls Supabase Auth and reads `public.profiles`, but the user explicitly requested authentication against the legacy `admins` table. This remains unresolved; do not treat current email-field validation as login parity or reuse the legacy bcrypt hash as an Auth password.
- Existing profile roles are not reset by the role-boundary migration. Because the older default was `Administrator`, review existing account roles with authorized access before relying on the role gate.
- The live Auth settings endpoint reports public signup enabled. The new local role-boundary migration blocks self-promotion and defaults new users to Technician, but its remote migration state is unverified; do not assume new signups are least-privileged until the migration is confirmed active.
- `npm run firmware:check` could read the existing project but the `complete_vend` assertion rejected its configured test device key. It did not create a sale; hardware/RPC reset behavior remains unverified.
