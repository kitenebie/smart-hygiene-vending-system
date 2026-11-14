$ErrorActionPreference = 'Stop'
$pgBin = if ($env:PG_BIN) { $env:PG_BIN } else { 'C:\Program Files\PostgreSQL\17\bin' }
$initdb = Join-Path $pgBin 'initdb.exe'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$psql = Join-Path $pgBin 'psql.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'
foreach ($tool in @($initdb, $pgCtl, $psql, $pgIsReady)) {
  if (!(Test-Path -LiteralPath $tool)) { throw "PostgreSQL tool not found: $tool (set PG_BIN to the PostgreSQL bin folder)" }
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$clusterRoot = Join-Path $env:TEMP ('4peace-machine-config-' + [guid]::NewGuid().ToString('N'))
if (![IO.Path]::GetFullPath($clusterRoot).StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to create a PostgreSQL test cluster outside the temporary directory.'
}
$data = Join-Path $clusterRoot 'data'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$started = $false
New-Item -ItemType Directory -Path $clusterRoot | Out-Null

try {
  & $initdb -D $data -U postgres -A trust --no-locale -E UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  $logPath = Join-Path $clusterRoot 'postgres.log'
  $startArgs = "-D `"$data`" -o `"-h 127.0.0.1 -p $port`" -l `"$logPath`" -w start"
  Start-Process -FilePath $pgCtl -ArgumentList $startArgs -WindowStyle Hidden | Out-Null
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & $pgIsReady -h 127.0.0.1 -p $port *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (!$ready) { throw 'PostgreSQL test server did not become ready' }

  $pgArgs = @('-h', '127.0.0.1', '-p', [string]$port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1')
  $fixturePath = Join-Path $clusterRoot 'fixtures.sql'
  @'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE TABLE public.machine_settings (
  id integer PRIMARY KEY,
  unit_price numeric NOT NULL,
  low_stock_threshold integer NOT NULL,
  admin_sms_number text,
  tamper_alarm_enabled boolean NOT NULL,
  credit_reset_token bigint NOT NULL DEFAULT 0,
  enable_pin_connection_detection boolean NOT NULL DEFAULT false,
  device_api_key text NOT NULL,
  wifi_password text,
  coin_box_alert_pct integer NOT NULL DEFAULT 80,
  auto_reset_coin_count boolean NOT NULL DEFAULT false,
  wifi_ssid text
);
ALTER TABLE public.machine_settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.machine_settings TO anon, authenticated;
INSERT INTO public.profiles VALUES
  ('11111111-1111-4111-8111-111111111111', 'Administrator'),
  ('22222222-2222-4222-8222-222222222222', 'Machine Technician');
INSERT INTO public.machine_settings VALUES
  (1, 14.5, 6, '+639000000000', true, 9, true, 'test-device-key', 'private-wifi-password', 80, false, 'machine-wifi');
'@ | Set-Content -LiteralPath $fixturePath -Encoding utf8
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed' }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20261113006500_safe_settings_read_rpc.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Safe settings read RPC migration failed' }
  $compatMigration = Join-Path $repoRoot 'supabase\migrations\20261113006900_machine_settings_profile_write_rls.sql'
  & $psql @pgArgs -f $compatMigration | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Machine settings firmware-compatible RLS migration failed' }
  & $psql @pgArgs -f $compatMigration | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Machine settings RLS migration was not idempotent' }

  $compatTestPath = Join-Path $clusterRoot 'compat-test.sql'
  @'
DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.machine_settings'::regclass) THEN RAISE EXCEPTION 'machine_settings RLS is disabled'; END IF;
  IF NOT has_table_privilege('anon', 'public.machine_settings', 'SELECT') OR has_table_privilege('anon', 'public.machine_settings', 'UPDATE') OR has_table_privilege('anon', 'public.machine_settings', 'INSERT') OR has_table_privilege('anon', 'public.machine_settings', 'DELETE') THEN RAISE EXCEPTION 'anon machine-settings grants are incorrect'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.machine_settings', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.machine_settings', 'UPDATE') OR has_table_privilege('authenticated', 'public.machine_settings', 'INSERT') OR has_table_privilege('authenticated', 'public.machine_settings', 'DELETE') THEN RAISE EXCEPTION 'authenticated machine-settings grants are incorrect'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE anon;
DO $$ DECLARE row_count integer; key_value text; wifi_value text; BEGIN
  SELECT count(*), max(device_api_key), max(wifi_password) INTO row_count, key_value, wifi_value FROM public.machine_settings;
  IF row_count <> 1 OR key_value <> 'test-device-key' OR wifi_value <> 'private-wifi-password' THEN RAISE EXCEPTION 'firmware select=* contract changed'; END IF;
  BEGIN UPDATE public.machine_settings SET unit_price = 99;
    RAISE EXCEPTION 'anon machine-settings write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE settings_row public.machine_settings%ROWTYPE; BEGIN
  UPDATE public.machine_settings SET
    unit_price = 15.75,
    low_stock_threshold = 7,
    admin_sms_number = '+639011111111',
    tamper_alarm_enabled = false,
    auto_reset_coin_count = true,
    enable_pin_connection_detection = true,
    device_api_key = 'replacement-device-key',
    wifi_ssid = 'MachineNet',
    wifi_password = 'replacement-wifi-password',
    coin_box_alert_pct = 75
  WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'administrator cannot update machine settings'; END IF;
  SELECT * INTO settings_row FROM public.machine_settings WHERE id = 1;
  IF settings_row.unit_price <> 15.75 OR settings_row.low_stock_threshold <> 7
     OR settings_row.admin_sms_number <> '+639011111111'
     OR settings_row.tamper_alarm_enabled OR NOT settings_row.auto_reset_coin_count
     OR NOT settings_row.enable_pin_connection_detection
     OR settings_row.device_api_key <> 'replacement-device-key'
     OR settings_row.wifi_ssid <> 'MachineNet'
     OR settings_row.wifi_password <> 'replacement-wifi-password'
     OR settings_row.coin_box_alert_pct <> 75 OR settings_row.credit_reset_token <> 9 THEN
    RAISE EXCEPTION 'machine settings form update did not persist all supplied fields';
  END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE current_password text; BEGIN
  UPDATE public.machine_settings SET unit_price = 16 WHERE id = 1;
  SELECT wifi_password INTO current_password FROM public.machine_settings WHERE id = 1;
  IF current_password <> 'private-wifi-password' THEN RAISE EXCEPTION 'blank password update overwrote saved Wi-Fi password'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  UPDATE public.machine_settings SET unit_price = 16 WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'technician cannot update machine settings'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ DECLARE row_count integer; BEGIN
  SELECT count(*) INTO row_count FROM public.machine_settings;
  IF row_count <> 0 THEN RAISE EXCEPTION 'unprofiled user can read machine settings'; END IF;
  UPDATE public.machine_settings SET unit_price = 99 WHERE id = 1;
  IF FOUND THEN RAISE EXCEPTION 'unprofiled user can update machine settings'; END IF;
END $$;
ROLLBACK;
'@ | Set-Content -LiteralPath $compatTestPath -Encoding utf8
  & $psql @pgArgs -f $compatTestPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Machine settings firmware compatibility or role checks failed' }

  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\deferred_migrations\20261113007000_machine_settings_device_rpc.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Machine settings hardening migration failed' }

  $testPath = Join-Path $clusterRoot 'test.sql'
  @'
DO $$ DECLARE result jsonb; BEGIN
  IF has_table_privilege('anon', 'public.machine_settings', 'SELECT') OR has_table_privilege('anon', 'public.machine_settings', 'UPDATE') THEN RAISE EXCEPTION 'anon retains machine settings table access'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.machine_settings', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.machine_settings', 'UPDATE') THEN RAISE EXCEPTION 'authenticated profile lost settings access'; END IF;
  IF has_table_privilege('authenticated', 'public.machine_settings', 'INSERT') OR has_table_privilege('authenticated', 'public.machine_settings', 'DELETE') THEN RAISE EXCEPTION 'authenticated role has unintended insert/delete access'; END IF;
  result := public.get_machine_config('test-device-key');
  IF result->>'success' <> 'true' OR result->>'unit_price' <> '14.5' OR result->>'credit_reset_token' <> '9' THEN RAISE EXCEPTION 'device config RPC returned incorrect settings: %', result; END IF;
  IF result ? 'device_api_key' OR result ? 'wifi_password' THEN RAISE EXCEPTION 'device config RPC exposed a secret'; END IF;
  result := public.get_machine_config('wrong-key');
  IF result->>'success' <> 'false' THEN RAISE EXCEPTION 'wrong device key accepted'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE result jsonb; BEGIN
  result := public.get_machine_settings_for_profile();
  IF result->>'id' <> '1' OR result->>'wifi_password_set' <> 'true' THEN RAISE EXCEPTION 'safe settings RPC omitted expected settings metadata: %', result; END IF;
  IF result ? 'wifi_password' OR result::text LIKE '%private-wifi-password%' THEN RAISE EXCEPTION 'safe settings RPC exposed the Wi-Fi password'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ DECLARE result jsonb; BEGIN
  result := public.get_machine_settings_for_profile();
  IF result->>'wifi_password_set' <> 'true' OR result ? 'wifi_password' THEN RAISE EXCEPTION 'technician settings response is incorrect: %', result; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ BEGIN
  BEGIN PERFORM public.get_machine_settings_for_profile();
    RAISE EXCEPTION 'unprofiled settings RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE row_count integer; BEGIN
  SELECT count(*) INTO row_count FROM public.machine_settings;
  IF row_count <> 1 THEN RAISE EXCEPTION 'profile cannot read machine settings'; END IF;
  UPDATE public.machine_settings SET unit_price = 15 WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile cannot update machine settings'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ DECLARE row_count integer; BEGIN
  SELECT count(*) INTO row_count FROM public.machine_settings;
  IF row_count <> 0 THEN RAISE EXCEPTION 'unprofiled user can read machine settings'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.get_machine_settings_for_profile();
    RAISE EXCEPTION 'anon settings RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM device_api_key FROM public.machine_settings;
    RAISE EXCEPTION 'anon read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN UPDATE public.machine_settings SET unit_price = 99;
    RAISE EXCEPTION 'anon update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
'@ | Set-Content -LiteralPath $testPath -Encoding utf8
  & $psql @pgArgs -f $testPath
  if ($LASTEXITCODE -ne 0) { throw 'Machine config access assertions failed' }
  'PASS: migration 069 preserves firmware select=* and allows full settings saves only for profiled admin/technician; deferred 070 safe read omits Wi-Fi password and checks the device key.'
}
finally {
  if ($started) {
    $stopArgs = "-D `"$data`" -m fast -w stop"
    Start-Process -FilePath $pgCtl -ArgumentList $stopArgs -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $clusterRoot) { Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}
