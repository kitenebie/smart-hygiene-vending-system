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
$clusterRoot = Join-Path $env:TEMP ('4peace-profile-role-' + [guid]::NewGuid().ToString('N'))
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
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.admins (id bigserial PRIMARY KEY, username text, password_hash text, full_name text, email text, phone text, role text, last_login timestamptz, created_at timestamptz DEFAULT now());
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
'@ | Set-Content -LiteralPath $fixturePath
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase Auth fixtures failed' }

  & $psql @pgArgs -f (Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\migrations\20261103000000_supabase_auth_profiles.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Auth profile migration failed' }
  $existingPath = Join-Path $clusterRoot 'existing-user.sql'
  @'
INSERT INTO auth.users(id, email, raw_user_meta_data)
VALUES ('11111111-1111-4111-8111-111111111111', 'existing@example.test', '{"username":"existing"}');
GRANT UPDATE (role) ON TABLE public.profiles TO authenticated;
'@ | Set-Content -LiteralPath $existingPath
  & $psql @pgArgs -f $existingPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Existing-profile fixture failed' }

  & $psql @pgArgs -f (Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\migrations\20261113003000_profiles_role_boundary.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Role-boundary migration failed' }
  $testPath = Join-Path $clusterRoot 'role-test.sql'
  @'
INSERT INTO auth.users(id, email, raw_user_meta_data)
VALUES ('22222222-2222-4222-8222-222222222222', 'new@example.test', '{"username":"newuser"}');
DO $$ BEGIN
  IF (SELECT role FROM public.profiles WHERE id='22222222-2222-4222-8222-222222222222') <> 'Machine Technician' THEN RAISE EXCEPTION 'new profile did not default to Technician'; END IF;
  IF (SELECT role FROM public.profiles WHERE id='11111111-1111-4111-8111-111111111111') <> 'Administrator' THEN RAISE EXCEPTION 'existing role changed'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET role='Administrator' WHERE id=auth.uid();
    RAISE EXCEPTION 'role escalation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
UPDATE public.profiles SET full_name='Allowed edit', last_login=now() WHERE id=auth.uid();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=auth.uid() AND full_name='Allowed edit') THEN RAISE EXCEPTION 'allowed profile edit failed'; END IF;
END $$;
ROLLBACK;
'@ | Set-Content -LiteralPath $testPath
  & $psql @pgArgs -f $testPath
  if ($LASTEXITCODE -ne 0) { throw 'Role-boundary assertions failed' }
  'PASS: new profile defaults to Technician; self-promotion is denied; own profile edit works; existing roles are preserved.'
}
finally {
  if ($started) {
    $stopArgs = "-D `"$data`" -m fast -w stop"
    Start-Process -FilePath $pgCtl -ArgumentList $stopArgs -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $clusterRoot) { Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}
