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

Legacy API paths are not routes in React. Their recovered behavior maps to direct Supabase queries/RPCs; 23 legacy API implementations are unavailable for exact comparison.
