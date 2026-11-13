ALTER TABLE public.machine_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.machine_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.machine_settings TO authenticated;

DROP POLICY IF EXISTS "machine settings: read profile" ON public.machine_settings;
CREATE POLICY "machine settings: read profile"
  ON public.machine_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

DROP POLICY IF EXISTS "machine settings: update profile" ON public.machine_settings;
CREATE POLICY "machine settings: update profile"
  ON public.machine_settings FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

CREATE OR REPLACE FUNCTION public.get_machine_config(p_device_key text)
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

  RETURN jsonb_build_object(
    'success', true,
    'unit_price', settings_row.unit_price,
    'low_stock_threshold', settings_row.low_stock_threshold,
    'admin_sms_number', settings_row.admin_sms_number,
    'tamper_alarm_enabled', settings_row.tamper_alarm_enabled,
    'credit_reset_token', settings_row.credit_reset_token,
    'enable_pin_connection_detection', settings_row.enable_pin_connection_detection
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_machine_config(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_machine_config(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
