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
$clusterRoot = Join-Path $env:TEMP ('4peace-read-rls-' + [guid]::NewGuid().ToString('N'))
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
CREATE TABLE public.device_health (id integer PRIMARY KEY, payload text);
CREATE TABLE public.device_resource_logs (id integer PRIMARY KEY, payload text);
CREATE TABLE public.esp32_logs (id integer PRIMARY KEY, payload text);
CREATE TABLE public.esp32_pin_status (id integer PRIMARY KEY, payload text);
CREATE TABLE public.esp32_device_presence (id integer PRIMARY KEY, payload text);
CREATE TABLE public.esp32_pin_devices (id integer PRIMARY KEY, payload text);
CREATE TABLE public.esp32_pin_device_assignments (id integer PRIMARY KEY, payload text);
ALTER TABLE public.device_health DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_resource_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.esp32_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.esp32_pin_status DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.esp32_device_presence DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.esp32_pin_devices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.esp32_pin_device_assignments DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.device_health, public.device_resource_logs, public.esp32_logs, public.esp32_pin_status, public.esp32_device_presence, public.esp32_pin_devices, public.esp32_pin_device_assignments TO anon, authenticated;
INSERT INTO public.profiles VALUES
  ('11111111-1111-4111-8111-111111111111', 'Administrator'),
  ('22222222-2222-4222-8222-222222222222', 'Machine Technician');
INSERT INTO public.device_health VALUES (1, 'health');
INSERT INTO public.device_resource_logs VALUES (1, 'resource');
INSERT INTO public.esp32_logs VALUES (1, 'log');
INSERT INTO public.esp32_pin_status VALUES (1, 'pin status');
INSERT INTO public.esp32_device_presence VALUES (1, 'presence');
INSERT INTO public.esp32_pin_devices VALUES (1, 'device');
INSERT INTO public.esp32_pin_device_assignments VALUES (1, 'assignment');
'@ | Set-Content -LiteralPath $fixturePath -Encoding utf8
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed' }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20261113006000_authenticated_operational_reads.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Authenticated-read RLS migration failed' }

  $testPath = Join-Path $clusterRoot 'test.sql'
  @'
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['device_health','device_resource_logs','esp32_logs','esp32_pin_status','esp32_device_presence','esp32_pin_devices','esp32_pin_device_assignments'] LOOP
    IF has_table_privilege('anon', 'public.' || table_name, 'SELECT') THEN RAISE EXCEPTION 'anon retains SELECT on %', table_name; END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || table_name, 'SELECT') THEN RAISE EXCEPTION 'authenticated lacks SELECT on %', table_name; END IF;
    IF has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') OR has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE') OR has_table_privilege('authenticated', 'public.' || table_name, 'DELETE') THEN RAISE EXCEPTION 'authenticated retains direct write on %', table_name; END IF;
  END LOOP;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE table_name text; row_count integer; BEGIN
  FOREACH table_name IN ARRAY ARRAY['device_health','device_resource_logs','esp32_logs','esp32_pin_status','esp32_device_presence','esp32_pin_devices','esp32_pin_device_assignments'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_count;
    IF row_count <> 1 THEN RAISE EXCEPTION 'authenticated profile cannot read %', table_name; END IF;
  END LOOP;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ DECLARE table_name text; row_count integer; BEGIN
  FOREACH table_name IN ARRAY ARRAY['device_health','device_resource_logs','esp32_logs','esp32_pin_status','esp32_device_presence','esp32_pin_devices','esp32_pin_device_assignments'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_count;
    IF row_count <> 0 THEN RAISE EXCEPTION 'unprofiled user can read %', table_name; END IF;
  END LOOP;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
DO $$ DECLARE table_name text; rejected boolean; BEGIN
  FOREACH table_name IN ARRAY ARRAY['device_health','device_resource_logs','esp32_logs','esp32_pin_status','esp32_device_presence','esp32_pin_devices','esp32_pin_device_assignments'] LOOP
    rejected := false;
    BEGIN EXECUTE format('SELECT count(*) FROM public.%I', table_name);
    EXCEPTION WHEN insufficient_privilege THEN rejected := true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'anon read unexpectedly succeeded on %', table_name; END IF;
  END LOOP;
END $$;
ROLLBACK;
'@ | Set-Content -LiteralPath $testPath -Encoding utf8
  & $psql @pgArgs -f $testPath
  if ($LASTEXITCODE -ne 0) { throw 'Operational read-RLS assertions failed' }
  'PASS: signed-in profiles can read operational telemetry/PIN data; anon and unprofiled users cannot; direct writes are revoked.'
}
finally {
  if ($started) {
    $stopArgs = "-D `"$data`" -m fast -w stop"
    Start-Process -FilePath $pgCtl -ArgumentList $stopArgs -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $clusterRoot) { Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}
