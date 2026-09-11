-- Run with supabase db query --linked --file supabase/tests/firmware_integration.sql
-- All fixture rows and stock changes are rolled back, even on test failure.
BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE
  token text;
  result jsonb;
  remaining integer;
  prefix text := 'qa-' || substr(md5(random()::text), 1, 12);
  rejected boolean;
  sms_id bigint;
  health_id integer;
BEGIN
  SELECT device_api_key INTO STRICT token FROM public.machine_settings ORDER BY id DESC LIMIT 1;
  INSERT INTO public.slots(id, slot_code, product_name, stock, capacity)
  VALUES (-900001, 'QA-TEST', 'Rollback-only firmware test', 5, 5);
  INSERT INTO public.gcash_payments(id, ref_code, slot_id, amount, status)
  VALUES (-900001, prefix, -900001, 10, 'approved');

  result := public.complete_vend(token, prefix || '-coin', 'QA', '', 'coin', -900001, 10);
  IF result->>'success' <> 'true' OR (result->>'stock')::int <> 4 THEN
    RAISE EXCEPTION 'coin completion failed';
  END IF;
  result := public.complete_vend(token, prefix || '-coin', 'QA', '', 'coin', -900001, 10);
  IF result->>'duplicate' <> 'true' OR (result->>'stock')::int <> 4 THEN
    RAISE EXCEPTION 'coin replay decremented stock';
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.complete_vend(token, prefix || '-bad', 'QA', prefix, 'gcash', -900001, 11);
  EXCEPTION WHEN OTHERS THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'wrong GCash amount accepted'; END IF;

  result := public.complete_vend(token, prefix || '-gcash', 'QA', prefix, 'gcash', -900001, 10);
  IF result->>'success' <> 'true' OR (result->>'stock')::int <> 3 THEN
    RAISE EXCEPTION 'GCash completion failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gcash_payments WHERE id = -900001 AND consumed_at IS NOT NULL AND status = 'approved') THEN
    RAISE EXCEPTION 'GCash consumption marker missing';
  END IF;
  result := public.complete_vend(token, prefix || '-gcash', 'QA', prefix, 'gcash', -900001, 10);
  IF result->>'duplicate' <> 'true' THEN RAISE EXCEPTION 'GCash replay failed'; END IF;

  rejected := false;
  BEGIN
    PERFORM public.complete_vend(token, prefix || '-reuse', 'QA', prefix, 'gcash', -900001, 10);
  EXCEPTION WHEN OTHERS THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'consumed reference reused'; END IF;

  rejected := false;
  BEGIN
    PERFORM public.complete_vend('invalid-test-token', prefix || '-invalid', 'QA', '', 'coin', -900001, 10);
  EXCEPTION WHEN invalid_authorization_specification THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'invalid device token accepted'; END IF;

  INSERT INTO public.sms (
    client_event_id, machine_id, event_type, recipient, message
  )
  VALUES (
    prefix || '-sms', 'QA', 'payment', '+639000000000', 'Rollback-only SMS test'
  )
  RETURNING id INTO sms_id;
  UPDATE public.sms
  SET attempt_count = 1, last_error = 'SIM800L send failed'
  WHERE id = sms_id;
  UPDATE public.sms SET status = 'sent' WHERE id = sms_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.sms
    WHERE id = sms_id AND status = 'sent' AND attempt_count = 1
      AND sent_at IS NOT NULL AND last_attempt_at IS NOT NULL
      AND last_error IS NULL
  ) THEN
    RAISE EXCEPTION 'SMS delivery state transition failed';
  END IF;

  SELECT stock INTO remaining FROM public.slots WHERE id = -900001;
  IF remaining <> 3 OR (SELECT count(*) FROM public.transactions WHERE slot_id = -900001) <> 2 THEN
    RAISE EXCEPTION 'incorrect transaction or stock totals';
  END IF;
  -- Health telemetry is deliberately RPC-only. This mirrors the ESP32 request
  -- without restoring broad anon INSERT/UPDATE permissions on its tables.
  SELECT id INTO STRICT health_id FROM public.device_health ORDER BY id LIMIT 1;
  result := public.sync_device_telemetry(
    token,
    'VM001',
    health_id,
    '{"esp32_uptime_seconds":5,"coin_pulses_session":0,"coin_box_pulses_total":0,"sim800l_signal_pct":0,"buck1_voltage":0,"buck2_voltage":0,"tamper_status":"idle"}'::jsonb,
    '{"internal_sram_total_bytes":1,"internal_sram_free_bytes":1,"external_psram_total_bytes":0,"external_psram_free_bytes":0,"external_flash_total_bytes":1,"external_flash_used_bytes":0,"filesystem_total_bytes":1,"filesystem_used_bytes":0,"rom_total_bytes":0,"cpu_temperature_c":25}'::jsonb
  );
  IF result->>'success' <> 'true' THEN
    RAISE EXCEPTION 'authenticated health telemetry failed: %', result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.device_health
    WHERE id = health_id AND esp32_uptime_seconds = 5 AND last_sync = now()
  ) THEN
    RAISE EXCEPTION 'health RPC did not update telemetry or timestamp';
  END IF;
END;
$$;
SELECT 'PASS: coin, GCash, replay, amount validation, consumed reference, device token, inventory, health timestamp, SMS outbox (anon role)' AS result;
ROLLBACK;
