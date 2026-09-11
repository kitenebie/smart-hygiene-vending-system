-- Run with: supabase db query --linked --file supabase/tests/esp32_pin_devices.sql
-- The test runs as anon and rolls its fixture data back.
BEGIN;
SET LOCAL ROLE anon;

DO $$
DECLARE
  created_device public.esp32_pin_devices;
  assignment_result jsonb;
  test_name text := 'QA device ' || substr(md5(random()::text), 1, 12);
BEGIN
  SELECT * INTO created_device
  FROM public.create_esp32_pin_device(test_name, 'https://example.com/test-device.png');

  IF created_device.id IS NULL OR created_device.name <> test_name THEN
    RAISE EXCEPTION 'device creation RPC failed';
  END IF;

  assignment_result := public.assign_esp32_pin_device('VM001', 12, created_device.id);
  IF assignment_result->>'success' <> 'true' THEN
    RAISE EXCEPTION 'device assignment RPC failed: %', assignment_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.esp32_pin_device_assignments
    WHERE machine_id = 'VM001' AND gpio = 12 AND device_id = created_device.id
  ) THEN
    RAISE EXCEPTION 'device assignment was not saved';
  END IF;
END;
$$;

SELECT 'PASS: ESP32 PIN device catalog and assignment RPCs (anon role)' AS result;
ROLLBACK;
