# PHP ↔ React module parity

| PHP page/module | React equivalent | Current parity/gap |
|---|---|---|
| Login/session | `LoginPage`, `AuthProvider` | React uses Supabase Auth email/password; PHP auth files are missing. Email-only follows latest user direction. |
| Overview/analytics | `OverviewView` | UI/data path exists; PHP endpoint source missing. |
| Slots/inventory/restock | `SlotsView` | UI and `restock_slot` RPC exist; exact PHP endpoint validation unavailable. |
| Transactions/GCash approval/export | `TransactionsView` | Listing, approve/reject, CSV exist; PHP API source missing. |
| Device Health | `HealthView` | Telemetry/history UI exists; new PHP coin reset button/status is missing. |
| Notifications/read-all | `NotificationsView` | UI/actions exist; PHP API source missing. |
| SMS logs | `SmsLogsView` | UI exists; PHP API source missing. |
| ESP32 logs | `Esp32LogsView` | UI exists; PHP API source missing. |
| ESP32 PIN status, assignment, device catalog | Settings + `Esp32PinStatusModal` | UI and RPC-backed actions exist; PHP endpoint source missing. |
| Product/slot settings | `SettingsView` | Product name/capacity controls exist. |
| Machine settings | `SettingsView` | Wi-Fi SSID/password and other fields exist; `credit_reset_token` is missing. |
| Admin profile/logout | `SettingsView`, Supabase Auth | Profile UI exists; PHP profile/auth source missing; React uses Auth-managed email/password. |
| Coin-balance reset | None | Missing from React; Supabase column and firmware token consumer also missing. |
| `gcash_payments.Notes` | None | No use found in either frontend; migrate data column only unless intended behavior is identified. |
| MySQL ↔ Supabase sync fallback | None | React queries Supabase directly; legacy sync API implementation is missing. |
| CSV export | `TransactionsView` | Present. |

PHP nav has eight dashboard views and React has all eight. This is not complete behavioral parity: coin-balance reset, current dump import, live DB verification, and missing PHP backend behavior remain open.
