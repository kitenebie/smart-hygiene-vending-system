-- Keep the firmware's existing GET contract while protecting writes.
ALTER TABLE public.machine_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.machine_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.machine_settings TO anon, authenticated;
GRANT UPDATE ON TABLE public.machine_settings TO authenticated;

-- shortcut: anon SELECT remains for firmware select=*; upgrade after a device-key read RPC is deployed.
DROP POLICY IF EXISTS "machine settings: firmware read" ON public.machine_settings;
CREATE POLICY "machine settings: firmware read"
  ON public.machine_settings FOR SELECT TO anon
  USING (true);

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

NOTIFY pgrst, 'reload schema';
