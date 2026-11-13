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
  'gcash_payments?select=status,consumed_at,slot_id,amount&limit=0',
  'transactions?select=device_tx_id,machine_id,payment_ref_code&limit=0',
  'device_health?id=eq.1&select=id,last_sync',
  'machine_health_logs?select=id&limit=0',
  'notifications?select=id&limit=0',
  'sms?select=id,status,attempt_count&limit=0',
]) {
  const result = await request(path);
  assert.equal(result.status, 200, `${path}: HTTP ${result.status}`);
  if (path.startsWith('device_health?')) assert.equal(result.data.length, 1);
  console.log(`PASS ${path.split('?')[0]}`);
}
const configResult = await request('rpc/get_machine_config', {
  method: 'POST', body: JSON.stringify({ p_device_key: values.DEVICE_API_KEY }),
});
assert.equal(configResult.status, 200, `get_machine_config: HTTP ${configResult.status}`);
assert.equal(configResult.data.success, true, 'device key must read machine configuration');
assert.ok('unit_price' in configResult.data && 'tamper_alarm_enabled' in configResult.data);
assert.equal('device_api_key' in configResult.data || 'wifi_password' in configResult.data, false, 'configuration RPC must omit secrets');
console.log('PASS protected machine config RPC and response fields');
const slotsResult = await request('rpc/get_machine_slots', {
  method: 'POST', body: JSON.stringify({ p_device_key: values.DEVICE_API_KEY }),
});
assert.equal(slotsResult.status, 200, `get_machine_slots: HTTP ${slotsResult.status}`);
assert.equal(slotsResult.data.length, 5, 'Expected five physical slots');
assert.deepEqual(slotsResult.data.map(s => s.slot_code).sort(), ['S1', 'S2', 'S3', 'S4', 'S5']);
assert.equal(slotsResult.data.some(s => s.id === 0), false, 'slot 0 must not exist before the no-write RPC probe');
console.log('PASS protected machine slots RPC and five-slot layout');
// Exercise the real firmware RPC signature/token without recording a sale:
// slot_id=0 is verified absent before calling, so the RPC must reject it.
const result = await request('rpc/complete_vend', {
  method: 'POST', body: JSON.stringify({
    p_device_key: values.DEVICE_API_KEY, p_device_tx_id: `check-${Date.now()}`,
    p_machine_id: 'VM001', p_ref_code: '', p_method: 'coin', p_slot_id: 0, p_amount: 10,
  }),
});
assert.equal(result.data.message, 'slot not found', 'RPC must accept the device token and reject the nonexistent test slot');
console.log('PASS complete_vend signature and device token; nonexistent slot rejected, no sale created');

// The health path must reject an unknown device key before it can update
// device_health or insert a resource telemetry row.
const telemetryResult = await request('rpc/sync_device_telemetry', {
  method: 'POST', body: JSON.stringify({
    p_device_key: 'invalid-device-key', p_machine_id: 'VM001', p_device_health_id: 1,
    p_health: {}, p_resource: {},
  }),
});
assert.equal(telemetryResult.data.success, false, 'invalid telemetry key must be rejected');
assert.equal(telemetryResult.data.message, 'invalid device key');
console.log('PASS authenticated telemetry RPC rejects an invalid device token');

const pinStatusResult = await request('rpc/sync_esp32_pin_status', {
  method: 'POST', body: JSON.stringify({
    p_device_key: 'invalid-device-key', p_machine_id: 'VM001', p_pins: [],
  }),
});
assert.equal(pinStatusResult.data.success, false, 'invalid PIN-status key must be rejected');
assert.equal(pinStatusResult.data.message, 'invalid device key');
console.log('PASS authenticated PIN-status RPC rejects an invalid device token');
console.log('Host API checks passed. USB flashing and 2.4 GHz device tests are still required.');
