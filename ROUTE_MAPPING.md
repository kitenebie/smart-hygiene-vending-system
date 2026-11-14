# Route mapping

| Legacy route | React route | Component |
|---|---|---|
| `login.php` | `/login` | `LoginPage` |
| `index.php` / `?view=overview` | `/` | `OverviewView` |
| `?view=slots` | `/?view=slots` | `SlotsView` |
| `?view=transactions` | `/?view=transactions` | `TransactionsView` |
| `?view=health` | `/?view=health` | `HealthView` |
| `?view=notifications` | `/?view=notifications` | `NotificationsView` |
| `?view=sms_logs` | `/?view=sms_logs` | `SmsLogsView` |
| `?view=esp32_logs` | `/?view=esp32_logs` | `Esp32LogsView` |
| `?view=settings` | `/?view=settings` | `SettingsView` |

Legacy API paths are not routes in React. Their recovered behavior maps to Supabase queries/RPCs. `app.js` references 21 distinct PHP API endpoints, and the `index.php` CSV link adds `api/transactions_export.php`: 22 referenced paths total, with only 3 handler files present. The missing export handler maps to the client-side `TransactionsView` CSV action; exact row, filter, and formatting parity is unverified.
