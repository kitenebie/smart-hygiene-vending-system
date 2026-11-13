-- Additive frontend read; keeps the existing firmware REST contract unchanged.
-- Rollback after reverting the React consumer: DROP FUNCTION IF EXISTS public.get_machine_settings_for_profile();
CREATE OR REPLACE FUNCTION public.get_machine_settings_for_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  settings_json jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('Administrator', 'Machine Technician')
  ) THEN
    RAISE EXCEPTION 'administrator profile required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'unit_price', s.unit_price,
    'low_stock_threshold', s.low_stock_threshold,
    'coin_box_alert_pct', s.coin_box_alert_pct,
    'admin_sms_number', s.admin_sms_number,
    'tamper_alarm_enabled', s.tamper_alarm_enabled,
    'auto_reset_coin_count', s.auto_reset_coin_count,
    'enable_pin_connection_detection', s.enable_pin_connection_detection,
    'device_api_key', s.device_api_key,
    'wifi_ssid', s.wifi_ssid,
    'wifi_password_set', COALESCE(s.wifi_password <> '', false)
  )
  INTO settings_json
  FROM public.machine_settings s
  ORDER BY s.id DESC
  LIMIT 1;

  RETURN settings_json;
END;
$$;

REVOKE ALL ON FUNCTION public.get_machine_settings_for_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_machine_settings_for_profile() TO authenticated;

NOTIFY pgrst, 'reload schema';
