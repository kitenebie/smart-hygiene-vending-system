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
  wifi_password text
);
ALTER TABLE public.machine_settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.machine_settings TO anon, authenticated;
INSERT INTO public.profiles VALUES
  ('11111111-1111-4111-8111-111111111111', 'Administrator'),
  ('22222222-2222-4222-8222-222222222222', 'Machine Technician');
INSERT INTO public.machine_settings VALUES
  (1, 14.5, 6, '+639000000000', true, 9, true, 'test-device-key', 'private-wifi-password');
'@ | Set-Content -LiteralPath $fixturePath -Encoding utf8
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed' }

  $repoRoot = Split-Path -Parent $PSScriptRoot
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
  'PASS: anon cannot read/update machine settings; authenticated profiles can read/update; device RPC validates key and omits key/password fields.'
}
finally {
  if ($started) {
    $stopArgs = "-D `"$data`" -m fast -w stop"
    Start-Process -FilePath $pgCtl -ArgumentList $stopArgs -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $clusterRoot) { Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}
