-- Dashboard telemetry and PIN metadata are visible to signed-in app users only.

REVOKE ALL ON TABLE
  public.device_health,
  public.device_resource_logs,
  public.esp32_logs,
  public.esp32_pin_status,
  public.esp32_device_presence,
  public.esp32_pin_devices,
  public.esp32_pin_device_assignments
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.device_health,
  public.device_resource_logs,
  public.esp32_logs,
  public.esp32_pin_status,
  public.esp32_device_presence,
  public.esp32_pin_devices,
  public.esp32_pin_device_assignments
TO authenticated;

DO $$
DECLARE
  table_name text;
  table_names text[] := ARRAY[
    'device_health', 'device_resource_logs', 'esp32_logs', 'esp32_pin_status',
    'esp32_device_presence', 'esp32_pin_devices', 'esp32_pin_device_assignments'
  ];
BEGIN
  FOREACH table_name IN ARRAY table_names LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated operational read', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN (''Administrator'', ''Machine Technician'')))',
      'authenticated operational read', table_name
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
