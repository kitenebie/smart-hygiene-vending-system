ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.slots TO authenticated;
GRANT UPDATE (product_name, capacity) ON TABLE public.slots TO authenticated;

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

CREATE OR REPLACE FUNCTION public.get_machine_slots(p_device_key text)
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
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'slot_code', s.slot_code,
      'product_name', s.product_name,
      'stock', s.stock,
      'capacity', s.capacity
    ) ORDER BY s.id)
    FROM public.slots s
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_machine_slots(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_machine_slots(text) TO anon, authenticated;

-- The device vend RPC still needs to update slot stock after table access is revoked.
ALTER FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) SECURITY DEFINER;
ALTER FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) SET search_path = '';
REVOKE ALL ON FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
