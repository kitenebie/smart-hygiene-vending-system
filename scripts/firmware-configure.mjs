import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const env = {};
for (const line of (await readFile(resolve(root, '.env'), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
const url = env.VITE_SUPABASE_URL || 'https://fjexweubnccjrinhxrct.supabase.co';
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_DRZfiimKuXLYdLvE-7iVxQ_yZLMr2OS';
if (!url || !key || !key.startsWith('sb_publishable_')) throw new Error('Expected the React Supabase URL and publishable key in .env');
const response = await fetch(`${url}/rest/v1/machine_settings?select=device_api_key&order=id.desc&limit=1`, {
  headers: { apikey: key }, signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`Settings HTTP ${response.status}`);
const settings = (await response.json())[0];
if (!settings?.device_api_key) throw new Error('Configure machine_settings.device_api_key first');
const target = resolve(root, 'firmware/4peace_esp32_firmware/config.local.h');
let previous = '';
try { previous = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const previousValue = (name, fallback) => {
  const match = previous.match(new RegExp(`^#define ${name} (".*")$`, 'm'));
  return match ? JSON.parse(match[1]) : fallback;
};
const values = {
  WIFI_SSID: process.env.FIRMWARE_WIFI_SSID ?? previousValue('WIFI_SSID', 'YOUR_WIFI_SSID'),
  WIFI_PASSWORD: process.env.FIRMWARE_WIFI_PASSWORD ?? previousValue('WIFI_PASSWORD', 'YOUR_WIFI_PASSWORD'),
  SUPABASE_URL: url,
  SUPABASE_KEY: key,
  DEVICE_API_KEY: settings.device_api_key,
};
await writeFile(target, '#pragma once\n// Local credentials. Do not commit or share this file.\n' +
  Object.entries(values).map(([name, value]) => `#define ${name} ${JSON.stringify(value)}`).join('\n') + '\n');
console.log('Firmware configuration synchronized with the React Supabase project. Credentials were not printed.');
console.log(`Wi-Fi configured: ${values.WIFI_SSID !== 'YOUR_WIFI_SSID'}`);
