-- Lightweight ESP32 presence signal for the dashboard's connected/waiting label.
-- The firmware writes this every 10 seconds. It does not create health-history rows.

CREATE TABLE IF NOT EXISTS public.esp32_device_presence (
  machine_id TEXT PRIMARY KEY,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT ON TABLE public.esp32_device_presence TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.heartbeat_esp32(
  p_device_key TEXT,
  p_machine_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_device_key TEXT;
BEGIN
  SELECT device_api_key
  INTO expected_device_key
  FROM public.machine_settings
  ORDER BY id DESC
  LIMIT 1;

  IF expected_device_key IS NULL OR p_device_key IS DISTINCT FROM expected_device_key THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid device key');
  END IF;

  IF p_machine_id <> 'VM001' THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid machine id');
  END IF;

  INSERT INTO public.esp32_device_presence (machine_id, last_seen)
  VALUES (p_machine_id, NOW())
  ON CONFLICT (machine_id) DO UPDATE SET last_seen = EXCLUDED.last_seen;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.heartbeat_esp32(TEXT, TEXT) TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'esp32_device_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.esp32_device_presence;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
