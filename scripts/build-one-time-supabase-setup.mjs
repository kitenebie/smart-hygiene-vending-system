import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrations = resolve('supabase/migrations');
const files = readdirSync(migrations)
  .filter(name => name.endsWith('.sql') && name !== '002_mock_data.sql' && name !== '20261103010000_import_legacy_mysql_data.sql')
  .sort();
const output = resolve('supabase/ONE_TIME_SETUP.sql');
const sql = [
  '-- 4Peace one-time Supabase setup.',
  '-- Additive only: no tables are dropped and imported rows never overwrite existing rows.',
  '-- Demo seed rows and the superseded Nov 3 dump are excluded.',
  '-- Development/staging only for now: legacy migrations disable RLS on several app tables.',
  ...files.flatMap(name => {
    let contents = readFileSync(resolve(migrations, name), 'utf8');
    if (name === '001_initial_schema.sql') {
      contents = contents.replace(/^INSERT INTO[\s\S]*?;\s*$/gm, '');
    }
    if (name === '20260912110000_repair_device_health_telemetry.sql') {
      contents = contents.replace(/-- Repairs telemetry[\s\S]*?ON CONFLICT \(id\) DO NOTHING;\s*/, '');
    }
    return [`\n-- ===== ${name} =====\n`, contents];
  }),
].join('\n');

writeFileSync(output, sql);
console.log(output);
