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
$clusterRoot = Join-Path $env:TEMP ('4peace-restock-' + [guid]::NewGuid().ToString('N'))
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
CREATE TABLE public.slots (
  id integer PRIMARY KEY,
  slot_code text NOT NULL,
  stock integer NOT NULL,
  capacity integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
'@ | Set-Content -LiteralPath $fixturePath -Encoding utf8
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed' }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20260915110000_slot_restock.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Legacy restock function setup failed' }
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20261113004000_restock_slot_role_guard.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Role-guard migration failed' }

  $seedPath = Join-Path $clusterRoot 'seed.sql'
  @'
INSERT INTO public.profiles VALUES
  ('11111111-1111-4111-8111-111111111111', 'Administrator'),
  ('22222222-2222-4222-8222-222222222222', 'Machine Technician');
INSERT INTO public.slots (id, slot_code, stock, capacity) VALUES
  (1, 'S1', 2, 5),
  (2, 'S2', 5, 5);
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.restock_slot(integer, integer)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can execute restock RPC'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.restock_slot(integer, integer)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot execute restock RPC'; END IF;
END $$;
'@ | Set-Content -LiteralPath $seedPath -Encoding utf8
  & $psql @pgArgs -f $seedPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Seed and grant assertions failed' }

  $callsPath = Join-Path $clusterRoot 'calls.sql'
  @'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE result jsonb; BEGIN
  result := public.restock_slot(1, 2);
  IF result->>'success' <> 'true' OR result->>'stock' <> '4' OR result->>'added' <> '2' THEN RAISE EXCEPTION 'administrator restock result incorrect: %', result; END IF;
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ DECLARE result jsonb; BEGIN
  result := public.restock_slot(1, 2);
  IF result->>'success' <> 'true' OR result->>'stock' <> '5' OR result->>'added' <> '1' THEN RAISE EXCEPTION 'technician restock/capacity result incorrect: %', result; END IF;
END $$;
DO $$ DECLARE result jsonb; BEGIN
  result := public.restock_slot(1, 0);
  IF result->>'success' <> 'false' OR result->>'message' <> 'quantity must be positive' THEN RAISE EXCEPTION 'invalid quantity was not rejected'; END IF;
  result := public.restock_slot(2, 1);
  IF result->>'success' <> 'false' OR result->>'message' <> 'slot is already at capacity' THEN RAISE EXCEPTION 'full slot was not rejected'; END IF;
  result := public.restock_slot(999, 1);
  IF result->>'success' <> 'false' OR result->>'message' <> 'slot not found' THEN RAISE EXCEPTION 'missing slot was not rejected'; END IF;
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ BEGIN
  BEGIN
    PERFORM public.restock_slot(1, 1);
    RAISE EXCEPTION 'unprofiled user restock unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
  BEGIN
    PERFORM public.restock_slot(1, 1);
    RAISE EXCEPTION 'anonymous restock unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF (SELECT stock FROM public.slots WHERE id=1) <> 5 THEN RAISE EXCEPTION 'valid restock stock total incorrect'; END IF;
  IF (SELECT stock FROM public.slots WHERE id=2) <> 5 THEN RAISE EXCEPTION 'invalid/full-slot call changed stock'; END IF;
END $$;
'@ | Set-Content -LiteralPath $callsPath -Encoding utf8
  & $psql @pgArgs -f $callsPath
  if ($LASTEXITCODE -ne 0) { throw 'Restock behavior/authorization assertions failed' }
  'PASS: admin and technician restock; capacity and invalid inputs are enforced; anon and unprofiled authenticated calls are denied without stock changes.'
}
finally {
  if ($started) {
    $stopArgs = "-D `"$data`" -m fast -w stop"
    Start-Process -FilePath $pgCtl -ArgumentList $stopArgs -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $clusterRoot) { Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}
