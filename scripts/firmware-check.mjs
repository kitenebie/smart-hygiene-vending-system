import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const header = await readFile(resolve(import.meta.dirname, '../firmware/4peace_esp32_firmware/config.local.h'), 'utf8');
const values = Object.fromEntries([...header.matchAll(/^#define (\w+) (".*")$/gm)].map(m => [m[1], JSON.parse(m[2])]));
const base = `${values.SUPABASE_URL}/rest/v1/`;
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options, headers: { apikey: values.SUPABASE_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}
for (const path of [
  'slots?select=id,slot_code,product_name,stock,capacity&order=id.asc',
  'machine_settings?select=unit_price,low_stock_threshold,tamper_alarm_enabled&order=id.desc&limit=1',
  'gcash_payments?select=status,consumed_at,slot_id,amount&limit=0',
  'transactions?select=device_tx_id,machine_id,payment_ref_code&limit=0',
  'device_health?id=eq.1&select=id,last_sync',
  'machine_health_logs?select=id&limit=0',
  'notifications?select=id&limit=0',
]) {
  const result = await request(path);
  assert.equal(result.status, 200, `${path}: HTTP ${result.status}`);
  if (path.startsWith('slots?')) {
    assert.equal(result.data.length, 5, 'Expected five physical slots');
    assert.deepEqual(result.data.map(s => s.slot_code).sort(), ['S1', 'S2', 'S3', 'S4', 'S5']);
  }
  if (path.startsWith('device_health?') || path.startsWith('machine_settings?')) assert.equal(result.data.length, 1);
  console.log(`PASS ${path.split('?')[0]}`);
}
// Exercise the real firmware RPC signature/token without recording a sale:
// slot_id=0 is verified absent before calling, so the RPC must reject it.
assert.deepEqual((await request('slots?id=eq.0&select=id')).data, []);
const result = await request('rpc/complete_vend', {
  method: 'POST', body: JSON.stringify({
    p_device_key: values.DEVICE_API_KEY, p_device_tx_id: `check-${Date.now()}`,
    p_machine_id: 'VM001', p_ref_code: '', p_method: 'coin', p_slot_id: 0, p_amount: 10,
  }),
});
assert.equal(result.data.message, 'slot not found', 'RPC must accept the device token and reject the nonexistent test slot');
console.log('PASS complete_vend signature and device token; nonexistent slot rejected, no sale created');
console.log('Host API checks passed. USB flashing and 2.4 GHz device tests are still required.');
