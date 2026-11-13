ALTER TABLE public.gcash_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gcash_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.gcash_payments TO authenticated;
GRANT UPDATE (status, resolved_at) ON TABLE public.gcash_payments TO authenticated;

DROP POLICY IF EXISTS "gcash: read profile" ON public.gcash_payments;
CREATE POLICY "gcash: read profile"
  ON public.gcash_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

DROP POLICY IF EXISTS "gcash: resolve pending profile" ON public.gcash_payments;
CREATE POLICY "gcash: resolve pending profile"
  ON public.gcash_payments FOR UPDATE TO authenticated
  USING (
    status = 'pending' AND consumed_at IS NULL AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
    )
  )
  WITH CHECK (
    status IN ('approved', 'rejected') AND consumed_at IS NULL AND resolved_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
    )
  );

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transactions TO authenticated;

DROP POLICY IF EXISTS "transactions: read profile" ON public.transactions;
CREATE POLICY "transactions: read profile"
  ON public.transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

CREATE OR REPLACE FUNCTION public.submit_gcash_payment(
  p_device_key text,
  p_ref_code text,
  p_slot_id integer,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  settings_row public.machine_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings_row
  FROM public.machine_settings
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND OR settings_row.device_api_key IS DISTINCT FROM p_device_key THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid device key');
  END IF;
  IF p_ref_code IS NULL OR p_ref_code <> btrim(p_ref_code) OR length(p_ref_code) < 4 OR length(p_ref_code) > 30 THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid reference');
  END IF;
  IF p_amount IS NULL OR p_amount IS DISTINCT FROM settings_row.unit_price THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid amount');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.slots WHERE id = p_slot_id AND stock > 0) THEN
    RETURN jsonb_build_object('success', false, 'message', 'slot unavailable');
  END IF;

  BEGIN
    INSERT INTO public.gcash_payments (ref_code, amount, slot_id, status)
    VALUES (p_ref_code, p_amount, p_slot_id, 'pending');
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'duplicate', true);
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_gcash_payment_status(
  p_device_key text,
  p_ref_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  settings_row public.machine_settings%ROWTYPE;
  payment_row public.gcash_payments%ROWTYPE;
BEGIN
  SELECT * INTO settings_row
  FROM public.machine_settings
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND OR settings_row.device_api_key IS DISTINCT FROM p_device_key THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid device key');
  END IF;
  IF p_ref_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid reference');
  END IF;

  SELECT * INTO payment_row
  FROM public.gcash_payments
  WHERE ref_code = p_ref_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'found', false);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'found', true,
    'status', payment_row.status,
    'consumed_at', payment_row.consumed_at,
    'slot_id', payment_row.slot_id,
    'amount', payment_row.amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_gcash_payment(text, text, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_gcash_payment(text, text, integer, numeric) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_gcash_payment_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gcash_payment_status(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
