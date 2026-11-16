-- Keep the firmware's public slot GET working while moving slot writes behind
-- profile authorization and the existing restock/vend RPCs.
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.slots TO anon, authenticated;
GRANT UPDATE (product_name, capacity) ON TABLE public.slots TO authenticated;

DROP POLICY IF EXISTS "slots: firmware read" ON public.slots;
CREATE POLICY "slots: firmware read"
  ON public.slots FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "slots: read profile" ON public.slots;
CREATE POLICY "slots: read profile"
  ON public.slots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

DROP POLICY IF EXISTS "slots: update product profile" ON public.slots;
CREATE POLICY "slots: update product profile"
  ON public.slots FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

NOTIFY pgrst, 'reload schema';
