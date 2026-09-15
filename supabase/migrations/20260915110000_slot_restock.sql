-- Atomically adds physical stock without exceeding the slot capacity.
CREATE OR REPLACE FUNCTION public.restock_slot(
  p_slot_id INTEGER,
  p_quantity INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_stock INTEGER;
  slot_capacity INTEGER;
  new_stock INTEGER;
BEGIN
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
  SET stock = new_stock,
      updated_at = NOW()
  WHERE id = p_slot_id;

  RETURN jsonb_build_object('success', true, 'stock', new_stock, 'added', new_stock - current_stock, 'capacity', slot_capacity);
END;
$$;

GRANT EXECUTE ON FUNCTION public.restock_slot(INTEGER, INTEGER) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
