# PHP ↔ React module parity

| PHP page/module | React equivalent | Current parity/gap |
|---|---|---|
| Login/session | `LoginPage`, `AuthProvider` | React currently uses Supabase Auth/`profiles`, while the user's instruction requested the legacy `admins` table; this is unresolved. PHP auth files are missing. Email format is validated in-browser, but that is not login parity. |
| Overview/analytics | `OverviewView` | UI/data path exists; PHP endpoint source missing. |
| Slots/inventory/restock | `SlotsView`, ESP32 firmware | React restock uses the role-guarded RPC. Candidate profile/device RLS and slot/vend RPCs pass disposable PostgreSQL tests, but are deferred; current firmware REST APIs are preserved. Live migration/data and hardware remain unverified. |
| Transactions/GCash approval/export | `TransactionsView`, ESP32 firmware | Candidate payment/transaction RLS and device RPCs pass disposable PostgreSQL tests, but are deferred; current firmware payment APIs are preserved. Live rollout, notification side effects, search/filter, and CSV remain unverified. |
| Device Health | `HealthView`, ESP32 firmware | Telemetry/history and admin-only coin reset exist. Candidate health-log RLS/device-write RPC passes disposable PostgreSQL tests, but is deferred; current firmware REST API remains. Live RLS and hardware verification pending. |
| Notifications/read-all | `NotificationsView`, ESP32 firmware | React read/mark-read actions exist. Candidate profile/device policies and firmware RPC pass disposable PostgreSQL tests, but are deferred; live migration/realtime behavior remain unverified. |
| SMS logs | `SmsLogsView` | UI exists; PHP API source missing; firmware still accesses the outbox through direct REST. |
| ESP32 logs | `Esp32LogsView` | UI exists; additive migration restricts reads to profiled users; live migration pending; PHP API source missing. |
| ESP32 PIN status, assignment, device catalog | Settings + `Esp32PinStatusModal` | Additive RLS and RPC guards allow authenticated Administrator/Machine Technician profiles; disposable PostgreSQL tests cover reads, creation, assignment, validation, and anon denial. Live migration and authenticated UI remain unverified; PHP endpoint source is missing. |
| Product/slot settings | `SettingsView` | Product name/capacity controls exist. |
| Machine settings | `SettingsView`, ESP32 firmware | React uses an authenticated safe-read RPC that returns only whether a Wi-Fi password is set; the disposable PostgreSQL test verifies admin/technician access and password omission. Device-key RLS/RPC migration 070 is still deferred; firmware REST remains unchanged. Live migration, authenticated UI saves, and hardware verification remain. |
| Admin profile/logout | `SettingsView`, Supabase Auth | Profile UI exists; PHP profile/auth source missing; auth-table choice remains unresolved. |
| Coin-balance reset | Health + Settings | Additive schema, admin-authorized RPC/notification, React controls, and ESP32 persistent token consumer implemented; Supabase and device verification pending. |
| `gcash_payments.Notes` | None | No use found in either frontend; migrate data column only unless intended behavior is identified. |
| MySQL ↔ Supabase sync fallback | None | React queries Supabase directly; legacy sync API implementation is missing. |
| CSV export | `TransactionsView` | Present. |

PHP nav has eight dashboard views and React has all eight. Coin reset parity is implemented locally; remaining gaps include remote migration verification and PHP backend behavior whose source files are missing.
