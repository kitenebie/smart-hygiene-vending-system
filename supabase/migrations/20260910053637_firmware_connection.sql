-- ============================================================================
-- 4Peace — Supabase FIX for safe vending transactions
-- Run this ONCE in Supabase SQL Editor before using the fixed firmware.
-- ============================================================================

-- 1) GCash reference must not be re-used.
ALTER TABLE public.gcash_payments
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gcash_payments_ref_code_uq
  ON public.gcash_payments (ref_code);

-- 2) Device transaction ID gives us idempotent replay after Wi-Fi loss/reboot.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS device_tx_id text NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS machine_id text NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_ref_code text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_device_tx_id_uq
  ON public.transactions (device_tx_id)
  WHERE device_tx_id IS NOT NULL;

-- 3) Atomic vend completion.
--    - validates device API key
--    - prevents duplicate device transaction replay
--    - validates unconsumed approved GCash payment
--    - locks and decrements stock atomically
--    - inserts transaction
--    - consumes GCash payment
CREATE OR REPLACE FUNCTION public.complete_vend(
  p_device_key text,
  p_device_tx_id text,
  p_machine_id text,
  p_ref_code text,
  p_method text,
  p_slot_id bigint,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_expected_key text;
  v_current_stock integer;
  v_new_stock integer;
  v_payment_status text;
  v_consumed_at timestamptz;
  v_payment_amount numeric;
BEGIN
  -- Validate current device key from latest machine settings.
  SELECT device_api_key
    INTO v_expected_key
  FROM public.machine_settings
  ORDER BY id DESC
  LIMIT 1;

  IF v_expected_key IS NULL OR p_device_key IS DISTINCT FROM v_expected_key THEN
    RAISE EXCEPTION 'invalid device key'
      USING ERRCODE = '28000';
  END IF;

  IF p_device_tx_id IS NULL OR length(trim(p_device_tx_id)) < 8 THEN
    RAISE EXCEPTION 'invalid device transaction id';
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('coin', 'gcash') THEN
    RAISE EXCEPTION 'invalid payment method';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 9999.99 THEN
    RAISE EXCEPTION 'invalid amount';
  END IF;
  IF p_machine_id IS NULL OR length(trim(p_machine_id)) = 0 THEN
    RAISE EXCEPTION 'invalid machine id';
  END IF;
  -- Serialize duplicate attempts before the existence check.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_tx_id, 0));

  -- Idempotency:
  -- if firmware already synced this transaction and retries after losing the ACK,
  -- return success without decrementing stock again.
  IF EXISTS (
    SELECT 1
    FROM public.transactions
    WHERE device_tx_id = p_device_tx_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.transactions
      WHERE device_tx_id = p_device_tx_id AND slot_id = p_slot_id
        AND machine_id = p_machine_id AND method = p_method AND amount = p_amount
        AND payment_ref_code IS NOT DISTINCT FROM NULLIF(p_ref_code, '')
    ) THEN
      RAISE EXCEPTION 'device transaction id reused with different details';
    END IF;
    SELECT stock
      INTO v_current_stock
    FROM public.slots
    WHERE id = p_slot_id;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'stock', v_current_stock
    );
  END IF;

  -- Validate GCash approval before completing a GCash vend.
  IF p_method = 'gcash' THEN
    SELECT status, consumed_at, amount
      INTO v_payment_status, v_consumed_at, v_payment_amount
    FROM public.gcash_payments
    WHERE ref_code = p_ref_code
      AND slot_id = p_slot_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'gcash reference not found';
    END IF;

    IF v_consumed_at IS NOT NULL OR v_payment_status = 'consumed' THEN
      RAISE EXCEPTION 'gcash reference already consumed';
    END IF;

    IF v_payment_amount IS DISTINCT FROM p_amount THEN
      RAISE EXCEPTION 'gcash amount mismatch';
    END IF;

    IF v_payment_status <> 'approved' THEN
      RAISE EXCEPTION 'gcash payment is not approved';
    END IF;
  END IF;

  -- Lock the stock row and verify availability.
  SELECT stock
    INTO v_current_stock
  FROM public.slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'slot not found';
  END IF;

  IF v_current_stock <= 0 THEN
    RAISE EXCEPTION 'slot is out of stock';
  END IF;

  UPDATE public.slots
  SET stock = stock - 1,
      updated_at = now()
  WHERE id = p_slot_id
  RETURNING stock INTO v_new_stock;

  INSERT INTO public.transactions (
    ref_code,
    method,
    slot_id,
    amount,
    device_tx_id,
    machine_id,
    payment_ref_code
  )
  VALUES (
    CASE
      WHEN p_method = 'gcash' THEN p_ref_code
      ELSE p_device_tx_id
    END,
    p_method,
    p_slot_id,
    p_amount,
    p_device_tx_id,
    p_machine_id,
    NULLIF(p_ref_code, '')
  );

  IF p_method = 'gcash' THEN
    UPDATE public.gcash_payments
    SET consumed_at = now(),
        resolved_at = COALESCE(resolved_at, now())
    WHERE ref_code = p_ref_code;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'stock', v_new_stock
  );
END;
$$;

-- Allow the Supabase publishable/anon client to execute this RPC.
-- Security still depends on the device key checked inside the function.
GRANT EXECUTE ON FUNCTION public.complete_vend(
  text, text, text, text, text, bigint, numeric
) TO anon, authenticated;

-- ============================================================================
-- IMPORTANT
-- Set machine_settings.device_api_key to the SAME value as DEVICE_API_KEY in
-- config.h before flashing the ESP32.
-- ============================================================================

-- consumed_at is the fulfillment marker. Keep the existing approved status
-- compatible with the original constraint and older dashboard versions.
CREATE OR REPLACE FUNCTION public.stamp_device_health_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.last_sync := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS stamp_device_health_sync ON public.device_health;
CREATE TRIGGER stamp_device_health_sync BEFORE UPDATE ON public.device_health
FOR EACH ROW EXECUTE FUNCTION public.stamp_device_health_sync();
NOTIFY pgrst, 'reload schema';
