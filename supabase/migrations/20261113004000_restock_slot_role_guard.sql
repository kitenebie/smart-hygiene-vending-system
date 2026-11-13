CREATE OR REPLACE FUNCTION public.restock_slot(
  p_slot_id integer,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_stock integer;
  slot_capacity integer;
  new_stock integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('Administrator', 'Machine Technician')
  ) THEN
    RAISE EXCEPTION 'Authenticated operator access required.' USING ERRCODE = '42501';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'quantity must be positive');
  END IF;

  SELECT stock, capacity
  INTO current_stock, slot_capacity
  FROM public.slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'slot not found');
  END IF;

  IF current_stock >= slot_capacity THEN
    RETURN jsonb_build_object('success', false, 'message', 'slot is already at capacity');
  END IF;

  new_stock := LEAST(slot_capacity, current_stock + p_quantity);

  UPDATE public.slots
  SET stock = new_stock, updated_at = now()
  WHERE id = p_slot_id;

  RETURN jsonb_build_object('success', true, 'stock', new_stock, 'added', new_stock - current_stock, 'capacity', slot_capacity);
END;
$$;

REVOKE ALL ON FUNCTION public.restock_slot(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_slot(integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
