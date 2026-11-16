-- Keep profile changes and legacy login credentials in sync through the Edge Function.
CREATE OR REPLACE FUNCTION public.get_legacy_admin_profile(p_user_id UUID)
RETURNS TABLE (id UUID, username TEXT, full_name TEXT, phone TEXT, email TEXT, role TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id, a.username::TEXT, a.full_name::TEXT, a.phone::TEXT, a.email::TEXT, a.role::TEXT
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  JOIN public.admins a ON lower(a.email) = lower(u.email)
  WHERE p.id = p_user_id AND p.role = 'Administrator'
$$;

CREATE OR REPLACE FUNCTION public.update_legacy_admin_profile(
  p_user_id UUID,
  p_previous_email TEXT,
  p_email TEXT,
  p_username TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_password TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, username TEXT, full_name TEXT, phone TEXT, email TEXT, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_id INTEGER;
  v_matches INTEGER;
  v_crypto_schema TEXT;
BEGIN
  IF p_email IS NULL OR length(p_email) > 150 OR p_username IS NULL
     OR char_length(btrim(p_username)) NOT BETWEEN 1 AND 50
     OR p_full_name IS NULL OR length(p_full_name) > 100
     OR length(coalesce(p_phone, '')) > 20
     OR octet_length(coalesce(p_password, '')) > 72 THEN
    RETURN;
  END IF;

  SELECT count(*), min(a.id) INTO v_matches, v_admin_id
  FROM public.admins a
  JOIN auth.users u ON lower(u.email) = lower(p_email)
  JOIN public.profiles p ON p.id = u.id
  WHERE p.id = p_user_id AND p.role = 'Administrator'
    AND lower(a.email) = lower(p_previous_email);

  IF v_matches <> 1 OR EXISTS (
    SELECT 1 FROM public.admins a
    WHERE a.id <> v_admin_id AND lower(a.email) = lower(p_email)
  ) THEN
    RETURN;
  END IF;

  SELECT n.nspname INTO v_crypto_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';
  IF v_crypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is required to update legacy admin credentials';
  END IF;

  EXECUTE format(
    'UPDATE public.admins SET username = $1, full_name = $2, email = $3, phone = $4,
       password_hash = CASE WHEN $5 IS NULL THEN password_hash
                            ELSE %1$I.crypt($5, %1$I.gen_salt(''bf'', 12)) END
     WHERE id = $6',
    v_crypto_schema
  ) USING p_username, p_full_name, p_email, p_phone, p_password, v_admin_id;

  UPDATE public.profiles SET username = p_username, full_name = p_full_name, phone = p_phone
  WHERE profiles.id = p_user_id;

  RETURN QUERY
  SELECT p.id, a.username::TEXT, a.full_name::TEXT, a.phone::TEXT, a.email::TEXT, a.role::TEXT
  FROM public.profiles p JOIN public.admins a ON a.id = v_admin_id
  WHERE p.id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_legacy_admin_profile(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_legacy_admin_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_legacy_admin_profile(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_legacy_admin_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
