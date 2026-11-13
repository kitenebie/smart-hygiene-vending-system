# Legacy MySQL → Supabase mapping

The current source is `Php_Version/4peace_db.sql`, a 2026-11-12 phpMyAdmin dump with 15 tables. The current React migrations cover the main dashboard/firmware tables, but the generated data import still comes from the older dump snapshot.

| MySQL table | Supabase table | React use / current gap |
|---|---|---|
| `admins` | `admins` (legacy archive); `auth.users` + `profiles` for login | Supabase Auth login; link authorized users to `profiles`. Never authenticate using the legacy hash column. |
| `slots` | `slots` | Overview, slots, settings, transactions |
| `transactions` | `transactions` | Overview, transaction history/export |
| `gcash_payments` | `gcash_payments` | Transaction approvals; source dump adds `Notes`, unused by both frontends |
| `device_health` | `device_health` | Overview and health |
| `device_resource_logs` | `device_resource_logs` | Health telemetry charts |
| `machine_health_logs` | `machine_health_logs` | Overview and health |
| `machine_settings` | `machine_settings` | Settings and firmware; dump contains Wi-Fi fields and new `credit_reset_token` |
| `notifications` | `notifications` | Badge, alert list, mark-read |
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
- `machine_settings.credit_reset_token INT NOT NULL DEFAULT 0`

React already has an additive migration for the Wi-Fi fields. It still needs an additive migration for `credit_reset_token`; import/consolidated SQL must be regenerated using the latest dump. Keep `002_mock_data.sql` out of production/setup SQL because it truncates tables and disables RLS.
