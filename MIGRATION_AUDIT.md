# Migration audit

Audited 2026-11-03. `Php_Version` was read only.

## Supplied legacy source

The archive contains `index.php`, dashboard CSS/JS, settings read/save APIs, a Supabase PHP helper, and `4peace.sql`. Its JavaScript references 25 PHP endpoints, but only two endpoint files are supplied. Referenced includes (`auth_check.php`, `config/db.php`, and `functions.php`) are also absent. This prevents a source-complete reconstruction of legacy authentication, the remaining endpoints, and their server-side authorization rules.

Recovered dashboard modules: Overview, Slots & Inventory, Transactions/GCash approval, Device Health, Notifications, SMS logs, ESP32 logs, Settings, ESP32 pin inspection, login/logout, CSV transaction export, polling, and realtime refresh.

## Existing React/Supabase implementation

The destination already contains React Router, all eight dashboard views, shared navigation/status components, Supabase queries/RPC calls, 13 SQL migrations, firmware integration, realtime listeners, and focused SQL tests. It uses TypeScript/TSX rather than the requested JavaScript/JSX; preserving the working project avoids a non-functional language-only rewrite.

## Critical gaps found

1. Browser authentication currently reads legacy `admins.password_hash`, permits a hard-coded administrator fallback, and stores a forged session in local storage. It is not Supabase Auth.
2. Existing migrations disable RLS and grant anonymous table access. Firmware directly reads/writes several tables using a publishable key, so enabling RLS without first moving those operations behind authenticated device RPCs/Edge Functions would break the machine.
3. `002_mock_data.sql` truncates tables and disables RLS. It is seed-only and must never be run against a shared or production project.
4. Existing `machine_settings` exposes a device API key through the table API. Moving this sensitive setting requires a firmware-compatible trusted endpoint before access can be locked down.
5. No Supabase credentials or reachable database schema were provided, so live CRUD/RLS verification is not possible in this workspace.

## Safe migration order

1. Apply only additive/non-destructive schema changes after taking a Supabase backup.
2. Create Supabase Auth accounts and link profiles; legacy plaintext/hash records cannot safely become Auth passwords. Require password reset or administrator-created invitations.
3. Move firmware table API traffic to device-key-validated RPCs or Edge Functions, then enable per-table RLS and remove anonymous grants.
4. Replace the React local-storage login with `supabase.auth` and profile lookup.
5. Apply and test RLS in staging with an administrator account and a real device before production.
