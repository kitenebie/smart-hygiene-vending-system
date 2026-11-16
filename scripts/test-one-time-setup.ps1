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
  $adminHashCheck = 'SELECT password_hash ~ ''^\$2[abxy]\$[0-9]{2}\$'' FROM public.admins WHERE username = ''admin'''
  $adminHashIsBcrypt = (& $psql @pgArgs -Atc $adminHashCheck).Trim()
  if ($LASTEXITCODE -ne 0 -or $adminHashIsBcrypt -ne 't') { throw 'Imported admin password hash was not preserved' }
  $adminHashFingerprint = (& $psql @pgArgs -Atc "SELECT md5(password_hash) FROM public.admins WHERE username = 'admin'").Trim()
  if ($LASTEXITCODE -ne 0 -or !$adminHashFingerprint) { throw 'Could not capture the disposable admin hash fingerprint' }
  & $psql @pgArgs -f $setupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ONE_TIME_SETUP.sql failed when reapplied to an existing schema' }
  $adminHashFingerprintAfter = (& $psql @pgArgs -Atc "SELECT md5(password_hash) FROM public.admins WHERE username = 'admin'").Trim()
  if ($LASTEXITCODE -ne 0 -or $adminHashFingerprintAfter -ne $adminHashFingerprint) { throw 'Reapplying the bundle changed the imported admin password hash' }

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
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.machine_settings'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.slots'::regclass) THEN
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
  IF NOT has_table_privilege('anon', 'public.slots', 'SELECT')
     OR has_table_privilege('anon', 'public.slots', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.slots', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.slots', 'product_name', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.slots', 'capacity', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.slots', 'stock', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.slots', 'INSERT')
     OR has_table_privilege('authenticated', 'public.slots', 'DELETE') THEN
    RAISE EXCEPTION 'slot firmware/profile grants are incorrect';
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
SET LOCAL ROLE anon;
DO $$ DECLARE item record; row_count integer := 0; BEGIN
  FOR item IN
    SELECT id, slot_code, product_name, stock, capacity
    FROM public.slots ORDER BY id
  LOOP
    IF item.id <= 0 OR item.slot_code IS NULL OR item.product_name IS NULL
       OR item.stock < 0 OR item.capacity < 0 THEN
      RAISE EXCEPTION 'firmware slot fields are incomplete';
    END IF;
    row_count := row_count + 1;
  END LOOP;
  IF row_count <> 5 THEN RAISE EXCEPTION 'firmware-compatible slot read returned % rows', row_count; END IF;
  BEGIN UPDATE public.slots SET stock = stock WHERE id = 1;
    RAISE EXCEPTION 'anonymous slot stock update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$ DECLARE stock_before integer; result jsonb; BEGIN
  UPDATE public.machine_settings SET unit_price = unit_price WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'administrator cannot update machine settings'; END IF;
  UPDATE public.slots SET product_name = product_name WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'administrator cannot edit slot product'; END IF;
  BEGIN UPDATE public.slots SET stock = stock WHERE id = 1;
    RAISE EXCEPTION 'direct slot stock update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT stock INTO stock_before FROM public.slots WHERE id = 1;
  UPDATE public.slots SET capacity = stock_before + 1 WHERE id = 1;
  result := public.restock_slot(1, 1);
  IF result->>'success' <> 'true' OR (result->>'stock')::integer <> stock_before + 1 THEN
    RAISE EXCEPTION 'authorized restock RPC failed under slot RLS: %', result;
  END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  UPDATE public.machine_settings SET unit_price = unit_price WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'technician cannot update machine settings'; END IF;
  UPDATE public.slots SET product_name = product_name, capacity = capacity WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'technician cannot edit slot product/capacity'; END IF;
  BEGIN UPDATE public.slots SET stock = stock WHERE id = 1;
    RAISE EXCEPTION 'technician direct slot stock update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
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
  SELECT count(*) INTO row_count FROM public.slots;
  IF row_count <> 0 THEN RAISE EXCEPTION 'unprofiled user can read slots'; END IF;
  UPDATE public.slots SET product_name = product_name WHERE id = 1;
  IF FOUND THEN RAISE EXCEPTION 'unprofiled user can update slots'; END IF;
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
  $fixtureInsert = "INSERT INTO public.admins (username, password_hash, full_name, email) VALUES ('hash_migration_test', 'plain-fixture-password', 'Hash Test', 'hash-test@example.test')"
  & $psql @pgArgs -c $fixtureInsert | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable plaintext-hash fixture' }
  $hashMigrationPath = Join-Path $repoRoot 'supabase\migrations\20261114002000_hash_legacy_admin_passwords.sql'
  & $psql @pgArgs -f $hashMigrationPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Legacy admin password migration failed on plaintext fixture' }
  $fixtureHashCheck = 'SELECT password_hash ~ ''^\$2[abxy]\$12\$'' FROM public.admins WHERE username = ''hash_migration_test'''
  $fixtureIsBcrypt = (& $psql @pgArgs -Atc $fixtureHashCheck).Trim()
  if ($LASTEXITCODE -ne 0 -or $fixtureIsBcrypt -ne 't') { throw 'Plaintext fixture was not converted to cost-12 bcrypt' }
  $fixturePasswordCheck = 'SELECT extensions.crypt(''plain-fixture-password'', password_hash) = password_hash FROM public.admins WHERE username = ''hash_migration_test'''
  $fixturePasswordMatches = (& $psql @pgArgs -Atc $fixturePasswordCheck).Trim()
  if ($LASTEXITCODE -ne 0 -or $fixturePasswordMatches -ne 't') { throw 'Bcrypt hash did not verify the fixture password' }
  $phpBcryptFixture = 'UPDATE public.admins SET password_hash = ''$2y$'' || substring(password_hash FROM 5) WHERE username = ''hash_migration_test'''
  & $psql @pgArgs -c $phpBcryptFixture | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create a PHP-compatible bcrypt fixture' }
  $adminLoginCheck = @'
SET ROLE service_role;
DO $$
DECLARE matched_count INTEGER;
BEGIN
  SELECT count(*) INTO matched_count FROM public.verify_legacy_admin_login('hash-test@example.test', 'plain-fixture-password', '192.0.2.10');
  IF matched_count <> 1 THEN RAISE EXCEPTION 'valid PHP bcrypt admin credential was rejected'; END IF;
  FOR attempt IN 1..5 LOOP
    PERFORM username FROM public.verify_legacy_admin_login('hash-test@example.test', 'wrong-password', '192.0.2.11');
  END LOOP;
  SELECT count(*) INTO matched_count FROM public.verify_legacy_admin_login('hash-test@example.test', 'plain-fixture-password', '192.0.2.11');
  IF matched_count <> 0 THEN RAISE EXCEPTION 'login throttle did not block the sixth attempt'; END IF;
END $$;
RESET ROLE;
'@
  $adminLoginCheckPath = Join-Path $clusterRoot 'admin-login-check.sql'
  $adminLoginCheck | Set-Content -LiteralPath $adminLoginCheckPath -Encoding utf8
  & $psql @pgArgs -f $adminLoginCheckPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Legacy admin login verification or throttle failed' }
  $adminLoginPrivileges = (& $psql @pgArgs -Atc "SELECT NOT has_function_privilege('anon', 'public.verify_legacy_admin_login(text,text,text)', 'EXECUTE') AND NOT has_table_privilege('anon', 'public.admin_login_attempts', 'SELECT')").Trim()
  if ($LASTEXITCODE -ne 0 -or $adminLoginPrivileges -ne 't') { throw 'Anonymous browser role can access privileged legacy login objects' }
  $profileUpdateCheck = @'
INSERT INTO auth.users (id, email) VALUES ('33333333-3333-4333-8333-333333333333', 'hash-test@example.test');
UPDATE public.profiles SET role = 'Administrator' WHERE id = '33333333-3333-4333-8333-333333333333';
SET ROLE service_role;
DO $$
DECLARE matched_count INTEGER;
BEGIN
  SELECT count(*) INTO matched_count FROM public.get_legacy_admin_profile('33333333-3333-4333-8333-333333333333');
  IF matched_count <> 1 THEN RAISE EXCEPTION 'admin profile lookup rejected its authenticated account'; END IF;
END $$;
RESET ROLE;
UPDATE auth.users SET email = 'hash-test-updated@example.test' WHERE id = '33333333-3333-4333-8333-333333333333';
SET ROLE service_role;
DO $$
DECLARE matched_count INTEGER;
BEGIN
  SELECT count(*) INTO matched_count FROM public.update_legacy_admin_profile(
    '33333333-3333-4333-8333-333333333333', 'hash-test@example.test', 'hash-test-updated@example.test',
    'hash_migration_test', 'Hash Test Updated', '+639000000000', 'new-fixture-password'
  );
  IF matched_count <> 1 THEN RAISE EXCEPTION 'legacy admin profile update failed'; END IF;
  SELECT count(*) INTO matched_count FROM public.get_legacy_admin_profile('22222222-2222-4222-8222-222222222222');
  IF matched_count <> 0 THEN RAISE EXCEPTION 'technician accessed the admin profile RPC'; END IF;
END $$;
RESET ROLE;
'@
  $profileUpdateCheckPath = Join-Path $clusterRoot 'admin-profile-update-check.sql'
  $profileUpdateCheck | Set-Content -LiteralPath $profileUpdateCheckPath -Encoding utf8
  & $psql @pgArgs -f $profileUpdateCheckPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Legacy admin profile RPC failed its authorized update check' }
  $updatedPasswordCheck = 'SELECT extensions.crypt(''new-fixture-password'', password_hash) = password_hash FROM public.admins WHERE email = ''hash-test-updated@example.test'''
  $updatedPasswordMatches = (& $psql @pgArgs -Atc $updatedPasswordCheck).Trim()
  if ($LASTEXITCODE -ne 0 -or $updatedPasswordMatches -ne 't') { throw 'Profile password change did not hash the new legacy credential' }
  $profileUpdatePrivileges = (& $psql @pgArgs -Atc "SELECT NOT has_function_privilege('anon', 'public.get_legacy_admin_profile(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.update_legacy_admin_profile(uuid,text,text,text,text,text,text)', 'EXECUTE')").Trim()
  if ($LASTEXITCODE -ne 0 -or $profileUpdatePrivileges -ne 't') { throw 'Anonymous browser role can access admin profile RPCs' }
  $fixtureHashFingerprint = (& $psql @pgArgs -Atc "SELECT md5(password_hash) FROM public.admins WHERE username = 'hash_migration_test'").Trim()
  if ($LASTEXITCODE -ne 0 -or !$fixtureHashFingerprint) { throw 'Could not capture the fixture hash fingerprint' }
  & $psql @pgArgs -f $hashMigrationPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Legacy admin password migration failed on reapplication' }
  $fixtureHashFingerprintAfter = (& $psql @pgArgs -Atc "SELECT md5(password_hash) FROM public.admins WHERE username = 'hash_migration_test'").Trim()
  if ($LASTEXITCODE -ne 0 -or $fixtureHashFingerprintAfter -ne $fixtureHashFingerprint) { throw 'Reapplying the password migration changed the bcrypt hash' }
  Write-Output 'PASS: setup bundle applies twice, all 15 imported table counts match, PHP bcrypt login/throttling and admin profile/password updates pass, anonymous access is denied, hashes remain stable, and slot/machine-settings RLS passes.'
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
