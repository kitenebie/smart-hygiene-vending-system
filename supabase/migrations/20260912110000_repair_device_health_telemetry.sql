-- Repairs telemetry after device_health was emptied/reset.
-- The ESP32 uses DEVICE_HEALTH_ID = 1, so retain that record and make the
-- telemetry RPC recreate it automatically if an administrator clears the table.

INSERT INTO public.device_health (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_device_telemetry(
  p_device_key text,
  p_machine_id text,
  p_device_health_id integer,
  p_health jsonb,
  p_resource jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_device_key text;
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

  IF p_device_health_id <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'invalid device health id');
  END IF;

  -- A TRUNCATE or manual cleanup must not permanently disable device telemetry.
  INSERT INTO public.device_health (id)
  VALUES (p_device_health_id)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.device_health
  SET esp32_uptime_seconds = COALESCE((p_health ->> 'esp32_uptime_seconds')::integer, esp32_uptime_seconds),
      coin_pulses_session = COALESCE((p_health ->> 'coin_pulses_session')::integer, coin_pulses_session),
      coin_box_pulses_total = COALESCE((p_health ->> 'coin_box_pulses_total')::integer, coin_box_pulses_total),
      sim800l_signal_pct = COALESCE((p_health ->> 'sim800l_signal_pct')::integer, sim800l_signal_pct),
      buck1_voltage = COALESCE((p_health ->> 'buck1_voltage')::numeric, buck1_voltage),
      buck2_voltage = COALESCE((p_health ->> 'buck2_voltage')::numeric, buck2_voltage),
      tamper_status = COALESCE(p_health ->> 'tamper_status', tamper_status)
  WHERE id = p_device_health_id;

  INSERT INTO public.device_resource_logs (
    machine_id, internal_sram_total_bytes, internal_sram_free_bytes,
    external_psram_total_bytes, external_psram_free_bytes,
    external_flash_total_bytes, external_flash_used_bytes,
    filesystem_total_bytes, filesystem_used_bytes, rom_total_bytes,
    cpu_temperature_c
  ) VALUES (
    p_machine_id,
    COALESCE((p_resource ->> 'internal_sram_total_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'internal_sram_free_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'external_psram_total_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'external_psram_free_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'external_flash_total_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'external_flash_used_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'filesystem_total_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'filesystem_used_bytes')::bigint, 0),
    COALESCE((p_resource ->> 'rom_total_bytes')::bigint, 0),
    NULLIF(p_resource ->> 'cpu_temperature_c', '')::numeric
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_device_telemetry(text, text, integer, jsonb, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
