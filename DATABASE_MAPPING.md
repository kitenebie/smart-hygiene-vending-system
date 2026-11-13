# Legacy MySQL → Supabase mapping

The current source is `Php_Version/4peace_db.sql`, a 2026-11-12 phpMyAdmin dump with 15 tables. It was imported into the isolated XAMPP database `4peace_legacy_staging_20261113`; generated PostgreSQL data is in `supabase/migrations/20261113002000_import_legacy_mysql_data.sql` and included in `supabase/ONE_TIME_SETUP.sql`.

| MySQL table | Supabase table | React use / current gap |
|---|---|---|
| `admins` | `admins` (legacy archive) | Current React login uses Supabase Auth/`profiles`, but the user requested the legacy `admins` table. This is unresolved; do not treat the current login as parity or copy legacy hashes into Auth. |
| `slots` | `slots` | Overview, slots, settings, transactions; current firmware uses the existing direct REST contract. Candidate device RPC/RLS migration is locally tested but deferred. |
| `transactions` | `transactions` | Overview, transaction history/export; candidate profile-read-only policy and device fulfillment RPC are locally tested but deferred. |
| `gcash_payments` | `gcash_payments` | Dashboard read/approval and firmware payment operations; candidate profile/device RPC policies are locally tested but deferred. Source `Notes` field remains unused. |
| `device_health` | `device_health` | Overview and health |
| `device_resource_logs` | `device_resource_logs` | Health telemetry charts |
| `machine_health_logs` | `machine_health_logs` | Health timeline; candidate profile-read and device-key firmware-write policies are locally tested but deferred. |
| `machine_settings` | `machine_settings` | Settings and firmware; dump contains Wi-Fi fields and new `credit_reset_token` |
| `notifications` | `notifications` | Badge, alert list, mark-read; candidate profile RLS and device-key firmware writes are locally tested but deferred. |
| `sms` | `sms` | SMS delivery logs |
| `esp32_logs` | `esp32_logs` | ESP32 log view and latest-credit parsing |
| `esp32_pin_status` | `esp32_pin_status` | PIN diagnostic modal |
| `esp32_pin_devices` | `esp32_pin_devices` | PIN device catalog |
| `esp32_pin_device_assignments` | `esp32_pin_device_assignments` | PIN assignment modal |
| `supabase_sync_state` | `supabase_sync_state` | Legacy PHP sync watermark; React does not use it |

## Schema delta from the previous checked-in dump

- `gcash_payments.Notes`
- `machine_settings.wifi_ssid`
- `machine_settings.wifi_password`
- `machine_settings.credit_reset_token BIGINT NOT NULL DEFAULT 0` (range-preserving conversion for the legacy integer token)

The additive schema migration is `20261113000000_legacy_schema_delta.sql`; the reset RPC is `20261113001000_coin_balance_reset_rpc.sql`. Device-security candidates `20261113007000`–`20261113010000` live under `supabase/deferred_migrations/` and are excluded from `ONE_TIME_SETUP.sql`; they need a compatible firmware rollout before deployment. The consolidated SQL excludes demo seeds and the superseded Nov 3 import. Data inserts use `ON CONFLICT DO NOTHING`: they preserve existing Supabase rows, so matching legacy IDs are not overwritten.
