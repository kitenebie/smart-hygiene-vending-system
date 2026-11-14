# Legacy MySQL → Supabase mapping

The current source is `Php_Version/4peace_db.sql`, a 2026-11-12 phpMyAdmin dump with 15 tables. It was imported into the isolated XAMPP database `4peace_legacy_staging_20261113`; generated PostgreSQL data is in `supabase/migrations/20261113002000_import_legacy_mysql_data.sql` and included in `supabase/ONE_TIME_SETUP.sql`.

| MySQL table | Supabase table | React use / current gap |
|---|---|---|
| `admins` | `admins` (private legacy archive) | Migration 068 enables RLS, revokes browser-role privileges, and removes the plaintext password default. Current React login uses Supabase Auth/`profiles`, while the user requested the legacy table; this remains unresolved. Do not copy legacy hashes into Auth. |
| `slots` | `slots` | Overview, slots, settings, transactions; current firmware uses the existing direct REST contract. Candidate device RPC/RLS migration is locally tested but deferred. |
| `transactions` | `transactions` | Overview, transaction history/export; standard migration 066 role-scopes reads and preserves the existing device fulfillment RPC; locally tested. |
| `gcash_payments` | `gcash_payments` | Dashboard read/approval and firmware payment operations; candidate profile/device RPC policies are locally tested but deferred. Source `Notes` field remains unused. |
| `device_health` | `device_health` | Overview and health |
| `device_resource_logs` | `device_resource_logs` | Health telemetry charts |
| `machine_health_logs` | `machine_health_logs` | Health timeline; standard migration 067 role-scopes reads and preserves the existing anon firmware POST with insert-only grants; device-key write RPC remains deferred. |
| `machine_settings` | `machine_settings` | Migration 069 enables RLS, denies anon writes, and scopes app reads/updates to Administrator/Machine Technician while preserving the firmware's `select=*` GET. That required anon read still exposes the row's Wi-Fi password and device key; the device-key read RPC remains deferred. |
| `notifications` | `notifications` | Badge, alert list, mark-read; standard migration 067 role-scopes reads and preserves the existing anon firmware POST with insert-only grants and `is_read = false`; device-key write RPC remains deferred. |
| `sms` | `sms` | SMS delivery logs |
| `esp32_logs` | `esp32_logs` | ESP32 log view and latest-credit parsing |
| `esp32_pin_status` | `esp32_pin_status` | PIN diagnostic modal |
| `esp32_pin_devices` | `esp32_pin_devices` | PIN device catalog |
| `esp32_pin_device_assignments` | `esp32_pin_device_assignments` | PIN assignment modal |
| `supabase_sync_state` | `supabase_sync_state` | Legacy PHP sync watermark; React does not use it. Migration 068 revokes browser-role access. |

## Schema delta from the previous checked-in dump

- `gcash_payments.Notes`
- `machine_settings.wifi_ssid`
- `machine_settings.wifi_password`
- `machine_settings.credit_reset_token BIGINT NOT NULL DEFAULT 0` (range-preserving conversion for the legacy integer token)

The additive standard migrations include `20261113000000_legacy_schema_delta.sql`, `20261113006500_safe_settings_read_rpc.sql`, migrations 066–069, and the reset RPC `20261113001000_coin_balance_reset_rpc.sql`. Migration 068 protects the legacy `admins` and `supabase_sync_state` tables and removes the password column's plaintext default. Migration 069 blocks anon writes to `machine_settings` while preserving firmware `select=*`; this necessarily leaves Wi-Fi credentials and the device key readable with the anon key. Device-security candidates `20261113007000`–`20261113010000` remain under `supabase/deferred_migrations/` and are excluded from `ONE_TIME_SETUP.sql`. Migration 067 keeps the firmware's existing health/notification POSTs insert-only for anon and only allows unread notifications; without a device credential in those requests, writes can still be forged. A fresh PostgreSQL bundle test confirms anon SELECT remains on `slots`, `machine_settings`, `gcash_payments`, and `sms`, so the bundle is not production-ready. The consolidated SQL excludes demo seeds and the superseded Nov 3 import. Data inserts use `ON CONFLICT DO NOTHING`: they preserve existing Supabase rows, so matching legacy IDs are not overwritten.
