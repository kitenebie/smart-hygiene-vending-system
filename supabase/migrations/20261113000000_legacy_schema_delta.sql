-- Preserve fields present in the Nov 12 MySQL snapshot.
ALTER TABLE public.machine_settings
  ADD COLUMN IF NOT EXISTS wifi_ssid text,
  ADD COLUMN IF NOT EXISTS wifi_password text,
  ADD COLUMN IF NOT EXISTS credit_reset_token bigint NOT NULL DEFAULT 0;

ALTER TABLE public.gcash_payments
  ADD COLUMN IF NOT EXISTS "Notes" varchar(255) NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
