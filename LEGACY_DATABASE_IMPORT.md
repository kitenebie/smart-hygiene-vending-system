# Legacy database import

`Php_Version/4peace.sql` has been restored locally into XAMPP database `4peace_legacy_import_20261103`. The existing `4peace_db` was preserved because it already contained machine data.

## Verified legacy row counts

| Table | Rows |
|---|---:|
| admins | 1 |
| device_health | 1 |
| device_resource_logs | 737 |
| esp32_logs | 4,879 |
| esp32_pin_device_assignments | 19 |
| esp32_pin_devices | 8 |
| esp32_pin_status | 34 |
| gcash_payments | 13 |
| machine_health_logs | 51 |
| machine_settings | 1 |
| notifications | 60 |
| slots | 5 |
| sms | 449 |
| supabase_sync_state | 5 |
| transactions | 467 |

## Supabase conversion

`supabase/migrations/20261103010000_import_legacy_mysql_data.sql` is the generated PostgreSQL data migration. It preserves source IDs, uses Postgres syntax, includes the legacy-only `supabase_sync_state` table, resets identity sequences, and uses `ON CONFLICT DO NOTHING`; it never deletes or updates existing Supabase data.

Regenerate it from the isolated XAMPP import:

```powershell
cd C:\Users\kenne\Desktop\em-res\4peace-app\react-app
node .\scripts\export-legacy-mysql-to-supabase.mjs
```

Apply only after reviewing the target project and backing it up. Do not run `002_mock_data.sql` in a shared or production Supabase project: it disables RLS and truncates tables.

The imported `admins.password_hash` remains an archived legacy field protected by RLS. It cannot be converted to Supabase Auth passwords. Create/verify an Auth account, then link it to `profiles` as documented in `20261103000000_supabase_auth_profiles.sql`.
