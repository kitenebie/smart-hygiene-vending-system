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

Legacy API paths are not routes in React. `Php_Version/assets/js/app.js` references 21 distinct PHP API endpoints, and `Php_Version/index.php` adds `api/transactions_export.php`: 22 paths total, with 3 handlers present and 19 absent inside `Php_Version`. The parent project has 11 overlapping handlers from an older 8-table, 6-view app; do not treat them as the missing target-version handlers. The React CSV action exists, but exact export row/column parity remains unverified.
