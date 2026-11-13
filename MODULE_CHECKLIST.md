# PHP ↔ React module parity

| PHP page/module | React equivalent | Current parity/gap |
|---|---|---|
| Login/session | `LoginPage`, `AuthProvider` | React currently uses Supabase Auth/`profiles`, while the user's instruction requested the legacy `admins` table; this is unresolved. PHP auth files are missing. Email format is validated in-browser, but that is not login parity. |
| Overview/analytics | `OverviewView` | UI/data path exists; PHP endpoint source missing. |
| Slots/inventory/restock | `SlotsView`, ESP32 firmware | Profile RLS allows reads and product/capacity edits; `get_machine_slots` validates the device key; restock uses the role-guarded RPC. Disposable PostgreSQL tests pass; live migration/data and hardware remain unverified. |
| Transactions/GCash approval/export | `TransactionsView` | Listing, approve/reject, CSV exist; PHP API source missing. |
| Device Health | `HealthView` | Telemetry/history UI and admin-only coin reset action implemented; additive migration restricts operational reads to profiled users; live RLS and hardware verification pending. |
| Notifications/read-all | `NotificationsView` | UI/actions exist; PHP API source missing. |
| SMS logs | `SmsLogsView` | UI exists; PHP API source missing. |
| ESP32 logs | `Esp32LogsView` | UI exists; additive migration restricts reads to profiled users; live migration pending; PHP API source missing. |
| ESP32 PIN status, assignment, device catalog | Settings + `Esp32PinStatusModal` | Additive RLS and RPC guards allow authenticated Administrator/Machine Technician profiles; disposable PostgreSQL tests cover reads, creation, assignment, validation, and anon denial. Live migration and authenticated UI remain unverified; PHP endpoint source is missing. |
| Product/slot settings | `SettingsView` | Product name/capacity controls exist. |
| Machine settings | `SettingsView`, ESP32 firmware | Profile-based table RLS and the device-key `get_machine_config` RPC pass disposable PostgreSQL tests; firmware no longer reads the table directly; remote migration, authenticated saves, and physical-device verification remain. |
| Admin profile/logout | `SettingsView`, Supabase Auth | Profile UI exists; PHP profile/auth source missing; auth-table choice remains unresolved. |
| Coin-balance reset | Health + Settings | Additive schema, admin-authorized RPC/notification, React controls, and ESP32 persistent token consumer implemented; Supabase and device verification pending. |
| `gcash_payments.Notes` | None | No use found in either frontend; migrate data column only unless intended behavior is identified. |
| MySQL ↔ Supabase sync fallback | None | React queries Supabase directly; legacy sync API implementation is missing. |
| CSV export | `TransactionsView` | Present. |

PHP nav has eight dashboard views and React has all eight. Coin reset parity is implemented locally; remaining gaps include remote migration verification and PHP backend behavior whose source files are missing.
