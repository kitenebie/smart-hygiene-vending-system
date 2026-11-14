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
$clusterRoot = Join-Path $env:TEMP ('4peace-setup-bundle-' + [guid]::NewGuid().ToString('N'))
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
  $startArgs = "-D `"$data`" -o `"-h 127.0.0.1 -p $port -c wal_level=logical`" -l `"$logPath`" -w start"
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
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE PUBLICATION supabase_realtime;
'@ | Set-Content -LiteralPath $fixturePath -Encoding utf8
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase Auth/Realtime fixtures failed' }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  $setupPath = Join-Path $repoRoot 'supabase\ONE_TIME_SETUP.sql'
  & $psql @pgArgs -f $setupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ONE_TIME_SETUP.sql failed on a fresh PostgreSQL database' }
  & $psql @pgArgs -f $setupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ONE_TIME_SETUP.sql failed when reapplied to an existing schema' }

  $assertPath = Join-Path $clusterRoot 'assertions.sql'
  @'
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin-test@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'technician-test@example.test');
UPDATE public.profiles SET role = 'Administrator' WHERE id = '11111111-1111-4111-8111-111111111111';

DO $$ DECLARE item record; actual bigint; BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('admins', 1::bigint), ('device_health', 1), ('device_resource_logs', 737),
      ('esp32_logs', 4879), ('esp32_pin_devices', 8), ('esp32_pin_device_assignments', 19),
      ('esp32_pin_status', 34), ('gcash_payments', 13), ('machine_health_logs', 51),
      ('machine_settings', 1), ('notifications', 60), ('sms', 449),
      ('supabase_sync_state', 5), ('slots', 5), ('transactions', 467)
    ) AS expected(table_name, row_count)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', item.table_name) INTO actual;
    IF actual <> item.row_count THEN
      RAISE EXCEPTION '% row count: expected %, got %', item.table_name, item.row_count, actual;
    END IF;
  END LOOP;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.transactions'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.machine_health_logs'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notifications'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.admins'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.supabase_sync_state'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.machine_settings'::regclass) THEN
    RAISE EXCEPTION 'an expected RLS table is not protected';
  END IF;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'password_hash') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy admin password_hash retains a plaintext default';
  END IF;
  IF has_table_privilege('anon', 'public.transactions', 'SELECT')
     OR has_table_privilege('anon', 'public.machine_health_logs', 'SELECT')
     OR has_table_privilege('anon', 'public.notifications', 'SELECT')
     OR has_table_privilege('anon', 'public.admins', 'SELECT')
     OR has_table_privilege('authenticated', 'public.admins', 'SELECT')
     OR has_table_privilege('anon', 'public.supabase_sync_state', 'SELECT') THEN
    RAISE EXCEPTION 'a client role can read a protected table';
  END IF;
  IF NOT has_table_privilege('anon', 'public.machine_settings', 'SELECT')
     OR has_table_privilege('anon', 'public.machine_settings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.machine_settings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.machine_settings', 'DELETE') THEN
    RAISE EXCEPTION 'machine settings firmware/read and app/write grants are incorrect';
  END IF;
  IF NOT has_column_privilege('anon', 'public.machine_health_logs', 'message', 'INSERT')
     OR NOT has_column_privilege('anon', 'public.notifications', 'is_read', 'INSERT') THEN
    RAISE EXCEPTION 'firmware-compatible insert grants are missing';
  END IF;
END $$;

BEGIN;
SET LOCAL ROLE anon;
DO $$ DECLARE settings_row record; BEGIN
  SELECT * INTO settings_row FROM public.machine_settings ORDER BY id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'firmware-compatible machine_settings select=* returned no row'; END IF;
  BEGIN UPDATE public.machine_settings SET unit_price = unit_price;
    RAISE EXCEPTION 'anon machine_settings write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
  UPDATE public.machine_settings SET unit_price = unit_price WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'administrator cannot update machine settings'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  UPDATE public.machine_settings SET unit_price = unit_price WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'technician cannot update machine settings'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ DECLARE row_count integer; BEGIN
  SELECT count(*) INTO row_count FROM public.machine_settings;
  IF row_count <> 0 THEN RAISE EXCEPTION 'unprofiled user can read machine settings'; END IF;
  UPDATE public.machine_settings SET unit_price = unit_price WHERE id = 1;
  IF FOUND THEN RAISE EXCEPTION 'unprofiled user can update machine settings'; END IF;
END $$;
ROLLBACK;

SELECT c.relname AS anon_select_table, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND has_table_privilege('anon', c.oid, 'SELECT')
ORDER BY c.relname;
'@ | Set-Content -LiteralPath $assertPath -Encoding utf8
  & $psql @pgArgs -f $assertPath
  if ($LASTEXITCODE -ne 0) { throw 'ONE_TIME_SETUP.sql assertions failed' }
  Write-Output 'PASS: setup bundle applies twice, all 15 imported table counts match, profile RLS protects machine-settings writes, and firmware select=* remains compatible.'
}
finally {
  if ($started) {
    & $pgCtl -D $data -m immediate stop *> $null
  }
  $resolvedCluster = [IO.Path]::GetFullPath($clusterRoot)
  if (!$resolvedCluster.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a test cluster outside the temporary directory.'
  }
  if (Test-Path -LiteralPath $resolvedCluster) { Remove-Item -LiteralPath $resolvedCluster -Recurse -Force }
}
