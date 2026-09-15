-- Server-timestamped ESP32 activity log for the dashboard.
CREATE TABLE IF NOT EXISTS public.esp32_logs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  category   TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS esp32_logs_machine_created_idx
  ON public.esp32_logs (machine_id, created_at DESC);

ALTER TABLE public.esp32_logs DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.esp32_logs TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.write_esp32_log(
  p_device_key TEXT,
  p_machine_id TEXT,
  p_level TEXT,
  p_category TEXT,
  p_message TEXT
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

  IF p_level NOT IN ('info', 'warning', 'error') OR length(trim(p_category)) = 0 OR length(trim(p_message)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid log event');
  END IF;

  INSERT INTO public.esp32_logs (machine_id, level, category, message)
  VALUES (p_machine_id, p_level, left(trim(p_category), 64), left(trim(p_message), 500));

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_esp32_log(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'esp32_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.esp32_logs;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
