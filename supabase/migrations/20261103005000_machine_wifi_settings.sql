ALTER TABLE public.machine_settings
  ADD COLUMN IF NOT EXISTS wifi_ssid TEXT,
  ADD COLUMN IF NOT EXISTS wifi_password TEXT;

ALTER TABLE public.machine_settings
  DROP CONSTRAINT IF EXISTS machine_settings_wifi_ssid_length,
  DROP CONSTRAINT IF EXISTS machine_settings_wifi_password_length;

ALTER TABLE public.machine_settings
  ADD CONSTRAINT machine_settings_wifi_ssid_length CHECK (wifi_ssid IS NULL OR char_length(wifi_ssid) <= 32),
  ADD CONSTRAINT machine_settings_wifi_password_length CHECK (wifi_password IS NULL OR char_length(wifi_password) <= 63);
