import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrations = resolve('supabase/migrations');
const files = readdirSync(migrations)
  .filter(name => name.endsWith('.sql') && name !== '002_mock_data.sql')
  .sort();
const output = resolve('supabase/ONE_TIME_SETUP.sql');
const sql = [
  '-- 4Peace one-time Supabase setup.',
  '-- Run only after clearing public tables. 002_mock_data.sql is intentionally excluded.',
  ...files.flatMap(name => [`\n-- ===== ${name} =====\n`, readFileSync(resolve(migrations, name), 'utf8')]),
].join('\n');

writeFileSync(output, sql);
console.log(output);
