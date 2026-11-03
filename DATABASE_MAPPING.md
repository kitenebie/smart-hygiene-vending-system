# Database mapping

| Legacy entity | Supabase entity | React consumer |
|---|---|---|
| `admins` | `admins` (legacy only) → planned `auth.users` + profile | auth/settings |
| `slots` | `slots` | overview, slots, settings, transactions |
| payments/sales | `transactions`, `gcash_payments` | overview, transactions |
| machine status | `device_health`, `device_resource_logs`, `machine_health_logs` | overview, health |
| machine config | `machine_settings` | overview, slots, settings, firmware |
| alerts | `notifications` | dashboard, notifications |
| SMS queue | `sms` | SMS logs, firmware |
| ESP32 diagnostics | `esp32_logs`, `esp32_pin_status`, `esp32_pin_devices`, `esp32_pin_device_assignments`, `esp32_device_presence` | ESP32 views/settings |

Existing migrations cover the entities above, telemetry, pin diagnostics, heartbeat, event logs, and atomic restocking. `002_mock_data.sql` is destructive test seed data, not a migration to run in production.
