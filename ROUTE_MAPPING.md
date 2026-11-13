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

Legacy API paths are not routes in React. Their recovered behavior maps to Supabase queries/RPCs. The JavaScript references 21 distinct PHP API endpoints; only 3 implementations are present, leaving 18 endpoint behaviors unavailable for exact comparison.
