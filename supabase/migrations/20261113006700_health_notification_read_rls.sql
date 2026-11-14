-- Hide operational history while keeping the firmware's existing REST POSTs.
ALTER TABLE public.machine_health_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.machine_health_logs, public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.machine_health_logs_id_seq, public.notifications_id_seq FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.machine_health_logs, public.notifications TO authenticated;
GRANT INSERT (level, message) ON TABLE public.machine_health_logs TO anon;
GRANT USAGE ON SEQUENCE public.machine_health_logs_id_seq TO anon;
GRANT INSERT (type, level, message, is_read) ON TABLE public.notifications TO anon;
GRANT USAGE ON SEQUENCE public.notifications_id_seq TO anon;
GRANT INSERT (type, level, message) ON TABLE public.notifications TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;
GRANT USAGE ON SEQUENCE public.notifications_id_seq TO authenticated;

DROP POLICY IF EXISTS "machine health: read profile" ON public.machine_health_logs;
CREATE POLICY "machine health: read profile"
  ON public.machine_health_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

DROP POLICY IF EXISTS "machine health: firmware insert" ON public.machine_health_logs;
CREATE POLICY "machine health: firmware insert"
  ON public.machine_health_logs FOR INSERT TO anon
  WITH CHECK (true);

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

DROP POLICY IF EXISTS "notifications: firmware insert" ON public.notifications;
CREATE POLICY "notifications: firmware insert"
  ON public.notifications FOR INSERT TO anon
  WITH CHECK (is_read = false);

NOTIFY pgrst, 'reload schema';
