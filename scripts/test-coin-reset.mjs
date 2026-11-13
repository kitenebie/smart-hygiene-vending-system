import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const helper = read('../src/utils/coinBalance.ts');
const legacy = read('../Php_Version/includes/functions.php');
const regexLiteral = helper.match(/\.match\((\/[^/]+\/[a-z]*)\)/)?.[1];
assert.ok(regexLiteral, 'latest credit parser must remain present');
assert.equal(legacy.match(/preg_match\('([^']+)'/)?.[1], regexLiteral, 'React balance parser must match PHP');
const lastSlash = regexLiteral.lastIndexOf('/');
const creditPattern = new RegExp(regexLiteral.slice(1, lastSlash), regexLiteral.slice(lastSlash + 1));
const parseCredit = message => {
  const match = message.match(creditPattern);
  return match ? Number(match[1]) : null;
};

assert.equal(parseCredit('IDLE; slot=none; credit=P0.00'), 0);
assert.equal(parseCredit('1 pulses -> P1.00; credit P1.00'), 1);
assert.equal(parseCredit('Coin credit P25.50'), 25.5);
assert.equal(parseCredit('credit=7'), 7);
assert.match(helper, /\.ilike\('message', '%credit%'\)[\s\S]*\.order\('id', \{ ascending: false \}\)[\s\S]*\.limit\(1\)/);
assert.equal(parseCredit('no reported balance'), null);

const schema = read('../supabase/migrations/20261113000000_legacy_schema_delta.sql');
const rpc = read('../supabase/migrations/20261113001000_coin_balance_reset_rpc.sql');
const health = read('../src/views/HealthView.tsx');
const settings = read('../src/views/SettingsView.tsx');
const firmware = read('../firmware/4peace_esp32_firmware/08_supabase.ino');
const setup = read('../supabase/ONE_TIME_SETUP.sql');

assert.match(schema, /ADD COLUMN IF NOT EXISTS credit_reset_token bigint NOT NULL DEFAULT 0/i);
assert.match(rpc, /role = 'Administrator'/);
assert.match(rpc, /FOR UPDATE/);
assert.match(rpc, /credit_reset_token = next_token/);
assert.match(rpc, /INSERT INTO public\.notifications/);
assert.match(rpc, /REVOKE ALL ON FUNCTION public\.request_coin_balance_reset\(\) FROM PUBLIC, anon/);
assert.match(rpc, /GRANT EXECUTE ON FUNCTION public\.request_coin_balance_reset\(\) TO authenticated/);
assert.match(helper, /rpc\('request_coin_balance_reset'\)/);
assert.match(health, /admin\?\.role === 'Administrator'/);
assert.match(settings, /admin\?\.role === 'Administrator'/);
assert.match(firmware, /requestedCreditReset > handledCreditReset/);
assert.match(firmware, /currentCredit = 0\.0f/);
assert.match(firmware, /persistCurrentCredit\(\)/);
assert.match(firmware, /putULong64\("creditReset"/);
assert.match(setup, /ADD COLUMN IF NOT EXISTS credit_reset_token bigint NOT NULL DEFAULT 0/i);
assert.match(setup, /CREATE OR REPLACE FUNCTION public\.request_coin_balance_reset\(\)/);
assert.match(setup, /GRANT EXECUTE ON FUNCTION public\.request_coin_balance_reset\(\) TO authenticated/);
assert.doesNotMatch(setup, /\b(DROP TABLE|TRUNCATE TABLE)\b/i);
assert.doesNotMatch(setup, /20261103010000_import_legacy_mysql_data\.sql/);

console.log('PASS coin reset parser, role gate, RPC wiring, firmware persistence, and setup safety checks');
