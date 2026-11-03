# Module checklist

| Module | Legacy evidence | React/Supabase status | Verification |
|---|---|---|---|
| Login/logout | `index.php`; missing auth include | UI exists; must replace local-storage authentication | blocked by Auth migration |
| Overview/analytics | `app.js` `overview.php` | implemented in `OverviewView` | build only |
| Slots/restock | `slots.php`, `slot_restock.php` calls | implemented with `restock_slot` RPC | SQL test exists; database unverified |
| Transactions/export | `transactions.php` call | implemented with CSV export | build only |
| GCash approvals | pending/approve API calls | implemented | database unverified |
| Device health | `health.php` call | implemented with telemetry resources | build only |
| Notifications | read/list API calls | implemented | database unverified |
| SMS logs | `sms_logs.php` call | implemented | build only |
| ESP32 logs | `esp32_logs.php` call | implemented | build only |
| ESP32 pin tools | pin API calls | implemented with RPC/table reads | database unverified |
| Settings/profile | supplied settings APIs | implemented; security migration required | database unverified |
| File storage/uploads | none found | not applicable | n/a |
| Reports/printing | CSV export only found | implemented | build only |

No module is marked source-verified because 23 referenced PHP endpoints are missing from the supplied legacy directory.
