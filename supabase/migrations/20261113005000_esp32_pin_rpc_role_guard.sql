CREATE OR REPLACE FUNCTION public.create_esp32_pin_device(
  p_name text,
  p_image_url text DEFAULT ''
)
RETURNS public.esp32_pin_devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  created_device public.esp32_pin_devices;
  normalized_name text := btrim(p_name);
  normalized_image_url text := btrim(COALESCE(p_image_url, ''));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('Administrator', 'Machine Technician')
  ) THEN
    RAISE EXCEPTION 'Authenticated operator access required.' USING ERRCODE = '42501';
  END IF;

  IF char_length(normalized_name) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'device name must be between 1 and 100 characters';
  END IF;

  IF normalized_image_url <> '' AND normalized_image_url !~* '^https?://.+' THEN
    RAISE EXCEPTION 'image link must start with http:// or https://';
  END IF;

  INSERT INTO public.esp32_pin_devices (name, image_url)
  VALUES (normalized_name, normalized_image_url)
  RETURNING * INTO created_device;

  RETURN created_device;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_esp32_pin_device(
  p_machine_id text,
  p_gpio integer,
  p_device_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('Administrator', 'Machine Technician')
  ) THEN
    RAISE EXCEPTION 'Authenticated operator access required.' USING ERRCODE = '42501';
  END IF;

  IF p_machine_id <> 'VM001' OR p_gpio NOT BETWEEN 0 AND 39 THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid machine or GPIO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.esp32_pin_devices WHERE id = p_device_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'device not found');
  END IF;

  INSERT INTO public.esp32_pin_device_assignments (machine_id, gpio, device_id, updated_at)
  VALUES (p_machine_id, p_gpio, p_device_id, now())
  ON CONFLICT (machine_id, gpio) DO UPDATE
  SET device_id = EXCLUDED.device_id, updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_esp32_pin_device(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_esp32_pin_device(text, integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_esp32_pin_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_esp32_pin_device(text, integer, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
