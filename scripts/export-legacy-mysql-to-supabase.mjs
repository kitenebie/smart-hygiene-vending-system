import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const database = process.argv[2] ?? '4peace_legacy_staging_20261113';
const mysql = 'C:\\xampp\\mysql\\bin\\mysql.exe';
const output = resolve('supabase/migrations/20261113002000_import_legacy_mysql_data.sql');
const tables = [
  'admins', 'device_health', 'device_resource_logs', 'esp32_logs', 'esp32_pin_devices',
  'esp32_pin_status', 'slots', 'esp32_pin_device_assignments', 'gcash_payments',
  'machine_health_logs', 'machine_settings', 'notifications', 'sms', 'supabase_sync_state', 'transactions',
];

function query(sql) {
  const result = spawnSync(mysql, ['-u', 'root', '--batch', '--raw', '--skip-column-names', database, '-e', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'MySQL query failed.');
  return result.stdout.trim() ? result.stdout.trim().split(/\r?\n/) : [];
}

function sqlValue(value, isBoolean) {
  if (value === null) return 'NULL';
  if (isBoolean) return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

let sql = `-- Generated from Php_Version/4peace.sql via scripts/export-legacy-mysql-to-supabase.mjs\n-- Additive import: existing Supabase rows are never updated or deleted.\n\n`;
sql += `CREATE TABLE IF NOT EXISTS public.supabase_sync_state (table_name text PRIMARY KEY, last_id bigint NOT NULL DEFAULT 0);\n\n`;

for (const table of tables) {
  const quote = String.fromCharCode(96);
  const columns = query(`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' ORDER BY ordinal_position`);
  if (!columns.length) throw new Error(`No MySQL columns found for ${table} in ${database}`);
  const booleans = new Set(query(`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' AND data_type = 'tinyint' AND column_type = 'tinyint(1)'`));
  const rows = query(`SELECT JSON_ARRAY(${columns.map(column => `${quote}${column}${quote}`).join(', ')}) FROM ${quote}${table}${quote}`);
  if (!rows.length) continue;
  const values = rows.map(row => `(${JSON.parse(row).map((value, index) => sqlValue(value, booleans.has(columns[index]))).join(', ')})`).join(',\n');
  const quotedColumns = columns.map(column => `"${column}"`).join(', ');
  const identity = table === 'esp32_logs' ? ' OVERRIDING SYSTEM VALUE' : '';
  sql += `INSERT INTO public."${table}" (${quotedColumns})${identity} VALUES\n${values}\nON CONFLICT DO NOTHING;\n\n`;
  if (columns.includes('id')) {
    sql += `SELECT setval(pg_get_serial_sequence('public.${table}', 'id'), COALESCE((SELECT MAX(id) FROM public."${table}"), 1), true);\n\n`;
  }
}

writeFileSync(output, sql);
console.log(output);
