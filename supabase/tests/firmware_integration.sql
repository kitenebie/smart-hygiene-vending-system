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

  SELECT stock INTO remaining FROM public.slots WHERE id = -900001;
  IF remaining <> 3 OR (SELECT count(*) FROM public.transactions WHERE slot_id = -900001) <> 2 THEN
    RAISE EXCEPTION 'incorrect transaction or stock totals';
  END IF;
  INSERT INTO public.device_health(id, last_sync) VALUES (-900001, '2000-01-01');
  UPDATE public.device_health SET esp32_uptime_seconds = 5 WHERE id = -900001;
  IF NOT EXISTS (SELECT 1 FROM public.device_health WHERE id = -900001 AND last_sync = now()) THEN
    RAISE EXCEPTION 'health timestamp did not advance';
  END IF;
END;
$$;
SELECT 'PASS: coin, GCash, replay, amount validation, consumed reference, device token, inventory, health timestamp (anon role)' AS result;
ROLLBACK;
