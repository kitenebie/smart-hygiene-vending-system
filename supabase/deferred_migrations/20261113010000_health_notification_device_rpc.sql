ALTER TABLE public.machine_health_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.machine_health_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.machine_health_logs TO authenticated;
REVOKE ALL ON SEQUENCE public.machine_health_logs_id_seq FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "machine health: read profile" ON public.machine_health_logs;
CREATE POLICY "machine health: read profile"
  ON public.machine_health_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

CREATE OR REPLACE FUNCTION public.write_machine_health_log(
  p_device_key text,
  p_level text,
  p_message text
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
  IF p_level IS NULL OR p_level NOT IN ('info', 'warning', 'critical') OR p_message IS NULL OR
     length(btrim(p_message)) = 0 OR length(p_message) > 255 THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid health log');
  END IF;

  INSERT INTO public.machine_health_logs (level, message)
  VALUES (p_level, p_message);
  RETURN jsonb_build_object('success', true);
END;
$$;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT INSERT (type, level, message) ON TABLE public.notifications TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;
REVOKE ALL ON SEQUENCE public.notifications_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.notifications_id_seq TO authenticated;

DROP POLICY IF EXISTS "notifications: read profile" ON public.notifications;
CREATE POLICY "notifications: read profile"
  ON public.notifications FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

DROP POLICY IF EXISTS "notifications: create profile" ON public.notifications;
CREATE POLICY "notifications: create profile"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

DROP POLICY IF EXISTS "notifications: mark read profile" ON public.notifications;
CREATE POLICY "notifications: mark read profile"
  ON public.notifications FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

CREATE OR REPLACE FUNCTION public.write_device_notification(
  p_device_key text,
  p_type text,
  p_level text,
  p_message text
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
  IF p_type IS NULL OR p_type NOT IN ('gcash', 'stock', 'coin_box', 'tamper', 'system', 'sms') OR
     p_level IS NULL OR p_level NOT IN ('info', 'warning', 'critical') OR p_message IS NULL OR
     length(btrim(p_message)) = 0 OR length(p_message) > 255 THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid notification');
  END IF;

  INSERT INTO public.notifications (type, level, message, is_read)
  VALUES (p_type, p_level, p_message, false);
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.write_machine_health_log(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_machine_health_log(text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.write_device_notification(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_device_notification(text, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
