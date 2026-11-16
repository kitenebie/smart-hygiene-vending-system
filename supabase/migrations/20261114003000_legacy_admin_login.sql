-- Verify legacy admin credentials server-side and throttle failed login attempts.
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  client_ip TEXT PRIMARY KEY CHECK (length(client_ip) BETWEEN 1 AND 80),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_login_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_legacy_admin_login(
  p_email TEXT,
  p_password TEXT,
  p_client_ip TEXT
)
RETURNS TABLE (username TEXT, full_name TEXT, phone TEXT, email TEXT, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_crypto_schema TEXT;
  v_admin public.admins%ROWTYPE;
  v_attempts INTEGER;
BEGIN
  IF p_email IS NULL OR p_password IS NULL OR p_client_ip IS NULL
     OR length(p_client_ip) NOT BETWEEN 1 AND 80 THEN
    RETURN;
  END IF;

  DELETE FROM public.admin_login_attempts
  WHERE window_started_at < now() - INTERVAL '1 day';

  INSERT INTO public.admin_login_attempts AS current_attempts (client_ip, window_started_at, attempts)
  VALUES (p_client_ip, now(), 1)
  ON CONFLICT (client_ip) DO UPDATE
  SET window_started_at = CASE
        WHEN current_attempts.window_started_at < now() - INTERVAL '15 minutes' THEN now()
        ELSE current_attempts.window_started_at
      END,
      attempts = CASE
        WHEN current_attempts.window_started_at < now() - INTERVAL '15 minutes' THEN 1
        ELSE current_attempts.attempts + 1
      END
  RETURNING attempts INTO v_attempts;

  IF v_attempts > 5 THEN
    RETURN;
  END IF;

  SELECT n.nspname INTO v_crypto_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_crypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is required to verify legacy admin credentials';
  END IF;

  EXECUTE format(
    'SELECT a.* FROM public.admins a
     WHERE lower(a.email) = lower($2)
       AND a.role IN (''Administrator'', ''Machine Technician'')
       AND %1$I.crypt($1, CASE WHEN left(a.password_hash, 4) = ''$2y$''
                               THEN ''$2a$'' || substr(a.password_hash, 5)
                               ELSE a.password_hash END)
           = CASE WHEN left(a.password_hash, 4) = ''$2y$''
                  THEN ''$2a$'' || substr(a.password_hash, 5)
                  ELSE a.password_hash END',
    v_crypto_schema
  ) INTO v_admin USING p_password, p_email;

  IF v_admin.id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.admin_login_attempts WHERE client_ip = p_client_ip;
  username := v_admin.username;
  full_name := v_admin.full_name;
  phone := v_admin.phone;
  email := v_admin.email;
  role := v_admin.role;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_legacy_admin_login(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_legacy_admin_login(TEXT, TEXT, TEXT) TO service_role;
