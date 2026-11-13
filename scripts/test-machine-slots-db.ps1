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
$clusterRoot = Join-Path $env:TEMP ('4peace-machine-slots-' + [guid]::NewGuid().ToString('N'))
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
CREATE TABLE public.slots (
  id integer PRIMARY KEY,
  slot_code text NOT NULL UNIQUE,
  product_name text NOT NULL,
  stock integer NOT NULL,
  capacity integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.gcash_payments (
  id serial PRIMARY KEY,
  ref_code varchar(30) NOT NULL,
  amount numeric(6,2) NOT NULL DEFAULT 10,
  slot_id integer REFERENCES public.slots(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
CREATE TABLE public.transactions (
  id serial PRIMARY KEY,
  ref_code text NOT NULL,
  method text NOT NULL,
  slot_id integer REFERENCES public.slots(id),
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.device_health (id serial PRIMARY KEY, last_sync timestamptz DEFAULT now());
ALTER TABLE public.machine_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.slots DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.machine_settings, public.slots, public.gcash_payments, public.transactions, public.device_health TO anon, authenticated;
INSERT INTO public.profiles VALUES
  ('11111111-1111-4111-8111-111111111111', 'Administrator'),
  ('22222222-2222-4222-8222-222222222222', 'Machine Technician');
INSERT INTO public.machine_settings VALUES
  (1, 14.5, 6, '+639000000000', true, 9, true, 'test-device-key', 'private-wifi-password');
INSERT INTO public.slots VALUES
  (1, 'S1', 'Water', 8, 30),
  (2, 'S2', 'Juice', 9, 30),
  (3, 'S3', 'Milk', 10, 30),
  (4, 'S4', 'Soda', 11, 30),
  (5, 'S5', 'Tea', 12, 30);
'@ | Set-Content -LiteralPath $fixturePath -Encoding utf8
  & $psql @pgArgs -f $fixturePath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed' }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20260910053637_firmware_connection.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Firmware vend RPC migration failed' }
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20261113007000_machine_settings_device_rpc.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Machine settings hardening migration failed' }
  & $psql @pgArgs -f (Join-Path $repoRoot 'supabase\migrations\20261113008000_authenticated_slots_device_rpc.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Slots hardening migration failed' }

  $testPath = Join-Path $clusterRoot 'test.sql'
  @'
DO $$ DECLARE result jsonb; BEGIN
  IF has_table_privilege('anon', 'public.slots', 'SELECT') OR has_table_privilege('anon', 'public.slots', 'UPDATE') THEN RAISE EXCEPTION 'anon retains slots table access'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.slots', 'SELECT') THEN RAISE EXCEPTION 'profiles lost slots read access'; END IF;
  IF NOT has_column_privilege('authenticated', 'public.slots', 'product_name', 'UPDATE') OR NOT has_column_privilege('authenticated', 'public.slots', 'capacity', 'UPDATE') THEN RAISE EXCEPTION 'profiles lost product/capacity edit access'; END IF;
  IF has_column_privilege('authenticated', 'public.slots', 'stock', 'UPDATE') OR has_table_privilege('authenticated', 'public.slots', 'INSERT') OR has_table_privilege('authenticated', 'public.slots', 'DELETE') THEN RAISE EXCEPTION 'profiles retain unintended slot write access'; END IF;
  result := public.get_machine_slots('test-device-key');
  IF jsonb_typeof(result) <> 'array' OR jsonb_array_length(result) <> 5 OR result->0->>'slot_code' <> 'S1' THEN RAISE EXCEPTION 'device slots RPC returned incorrect rows: %', result; END IF;
  IF result->0 ? 'device_api_key' OR result->0 ? 'wifi_password' THEN RAISE EXCEPTION 'slots RPC exposed a secret'; END IF;
  result := public.get_machine_slots('wrong-key');
  IF jsonb_typeof(result) <> 'array' OR jsonb_array_length(result) <> 0 THEN RAISE EXCEPTION 'wrong device key returned slots'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.complete_vend(text,text,text,text,text,bigint,numeric)'::regprocedure) THEN RAISE EXCEPTION 'complete_vend must use definer rights to update protected stock'; END IF;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE row_count integer; BEGIN
  SELECT count(*) INTO row_count FROM public.slots;
  IF row_count <> 5 THEN RAISE EXCEPTION 'profile cannot read slots'; END IF;
  UPDATE public.slots SET product_name = 'Water renamed', capacity = 31 WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile cannot edit product/capacity'; END IF;
  BEGIN UPDATE public.slots SET stock = 29 WHERE id = 1;
    RAISE EXCEPTION 'direct stock update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
DO $$ DECLARE row_count integer; BEGIN
  SELECT count(*) INTO row_count FROM public.slots;
  IF row_count <> 0 THEN RAISE EXCEPTION 'unprofiled user can read slots'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
DO $$ DECLARE result jsonb; BEGIN
  result := public.get_machine_slots('test-device-key');
  IF jsonb_array_length(result) <> 5 THEN RAISE EXCEPTION 'device key RPC failed for anon device role'; END IF;
  BEGIN PERFORM id FROM public.slots;
    RAISE EXCEPTION 'anon slot read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
DO $$ DECLARE result jsonb; BEGIN
  BEGIN
    PERFORM public.complete_vend('wrong-key', 'denied-vend-0001', 'VM001', '', 'coin', 1, 14.5);
    RAISE EXCEPTION 'complete_vend accepted an invalid key';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL;
  END;
  result := public.complete_vend('test-device-key', 'valid-vend-0001', 'VM001', '', 'coin', 1, 14.5);
  IF result->>'success' <> 'true' OR result->>'stock' <> '7' THEN RAISE EXCEPTION 'complete_vend could not update protected slot stock: %', result; END IF;
END $$;
ROLLBACK;
'@ | Set-Content -LiteralPath $testPath -Encoding utf8
  & $psql @pgArgs -f $testPath
  if ($LASTEXITCODE -ne 0) { throw 'Slots access assertions failed' }
  'PASS: device-key RPC returns safe slot rows; anon and unprofiled reads are denied; profiled users can edit product/capacity but not stock.'
}
finally {
  if ($started) {
    $stopArgs = "-D `"$data`" -m fast -w stop"
    Start-Process -FilePath $pgCtl -ArgumentList $stopArgs -WindowStyle Hidden -Wait | Out-Null
  }
  if (Test-Path -LiteralPath $clusterRoot) { Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}
