CREATE OR REPLACE FUNCTION public.request_coin_balance_reset()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  settings_id integer;
  next_token bigint;
  reset_message text := 'Coin balance reset requested — the machine will set inserted credit to ₱0';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'Administrator'
  ) THEN
    RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501';
  END IF;

  SELECT id, credit_reset_token
  INTO settings_id, next_token
  FROM public.machine_settings
  ORDER BY id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Machine settings not found.' USING ERRCODE = 'P0002';
  END IF;

  next_token := next_token + 1;
  UPDATE public.machine_settings
  SET credit_reset_token = next_token, updated_at = now()
  WHERE id = settings_id;

  INSERT INTO public.notifications (type, level, message)
  VALUES ('system', 'info', reset_message);

  RETURN next_token;
END;
$$;

REVOKE ALL ON FUNCTION public.request_coin_balance_reset() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_coin_balance_reset() TO authenticated;

NOTIFY pgrst, 'reload schema';
