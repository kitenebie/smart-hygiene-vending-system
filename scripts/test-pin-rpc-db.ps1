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
$clusterRoot = Join-Path $env:TEMP ('4peace-pin-rpc-' + [guid]::NewGuid().ToString('N'))
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
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('Administrator', 'Machine Technician'))
);
CREATE PUBLICATION supabase_realtime;
'@ | Set-Content -LiteralPath $fixturePath -Encoding utf8
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed' }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20260911140000_esp32_pin_devices.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Legacy PIN RPC setup failed' }
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20261113005000_esp32_pin_rpc_role_guard.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PIN RPC role-guard migration failed' }

  $testPath = Join-Path $clusterRoot 'test.sql'
  @'
INSERT INTO public.profiles VALUES
  ('11111111-1111-4111-8111-111111111111', 'Administrator'),
  ('22222222-2222-4222-8222-222222222222', 'Machine Technician');
INSERT INTO public.esp32_pin_devices (name, image_url) VALUES ('Relay', '');
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.create_esp32_pin_device(text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can create PIN devices'; END IF;
  IF has_function_privilege('anon', 'public.assign_esp32_pin_device(text, integer, bigint)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can assign PIN devices'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_esp32_pin_device(text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot create PIN devices'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.assign_esp32_pin_device(text, integer, bigint)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot assign PIN devices'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE created public.esp32_pin_devices; BEGIN
  created := public.create_esp32_pin_device('  Buzzer  ', 'https://example.test/buzzer.png');
  IF created.name <> 'Buzzer' OR created.image_url <> 'https://example.test/buzzer.png' THEN RAISE EXCEPTION 'device creation normalization failed'; END IF;
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ DECLARE result jsonb; BEGIN
  result := public.assign_esp32_pin_device('VM001', 12, 1);
  IF result->>'success' <> 'true' THEN RAISE EXCEPTION 'valid PIN assignment failed: %', result; END IF;
  result := public.assign_esp32_pin_device('other', 40, 999);
  IF result->>'success' <> 'false' OR result->>'message' <> 'invalid machine or GPIO' THEN RAISE EXCEPTION 'invalid assignment was not rejected'; END IF;
  result := public.assign_esp32_pin_device('VM001', 13, 999);
  IF result->>'success' <> 'false' OR result->>'message' <> 'device not found' THEN RAISE EXCEPTION 'missing device was not rejected'; END IF;
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ DECLARE rejected boolean; BEGIN
  rejected := false;
  BEGIN PERFORM public.create_esp32_pin_device('  ', '');
  EXCEPTION WHEN raise_exception THEN rejected := SQLERRM = 'device name must be between 1 and 100 characters'; END;
  IF NOT rejected THEN RAISE EXCEPTION 'blank device name was not rejected'; END IF;
  rejected := false;
  BEGIN PERFORM public.create_esp32_pin_device('Bad image', 'javascript:alert(1)');
  EXCEPTION WHEN raise_exception THEN rejected := SQLERRM = 'image link must start with http:// or https://'; END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid image URL was not rejected'; END IF;
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ BEGIN
  BEGIN PERFORM public.create_esp32_pin_device('Unprofiled', '');
    RAISE EXCEPTION 'unprofiled create unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
  BEGIN PERFORM public.create_esp32_pin_device('Anonymous', '');
    RAISE EXCEPTION 'anonymous create unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN PERFORM public.assign_esp32_pin_device('VM001', 14, 1);
    RAISE EXCEPTION 'anonymous assignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.esp32_pin_devices) <> 2 THEN RAISE EXCEPTION 'denied call changed PIN device catalog'; END IF;
  IF (SELECT count(*) FROM public.esp32_pin_device_assignments) <> 1 THEN RAISE EXCEPTION 'denied call changed PIN assignments'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.esp32_pin_device_assignments WHERE machine_id='VM001' AND gpio=12 AND device_id=1) THEN RAISE EXCEPTION 'valid assignment not persisted'; END IF;
END $$;
'@ | Set-Content -LiteralPath $testPath -Encoding utf8
  & $psql @pgArgs -f $testPath
  if ($LASTEXITCODE -ne 0) { throw 'PIN RPC behavior/authorization assertions failed' }
  'PASS: authenticated admin/technician catalog and assignment actions work; validation is preserved; anon/unprofiled calls are denied without writes.'
}
finally {
  if ($started) {
    $stopArgs = "-D `"$data`" -m fast -w stop"
    Start-Process -FilePath $pgCtl -ArgumentList $stopArgs -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $clusterRoot) { Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}
