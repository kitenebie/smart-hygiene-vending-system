-- Hash legacy plaintext credentials in place without copying them into Auth.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  crypto_schema text;
BEGIN
  SELECT n.nspname INTO crypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF crypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is required to hash legacy admin credentials';
  END IF;

  EXECUTE format(
    'UPDATE public.admins
     SET password_hash = %1$I.crypt(password_hash, %1$I.gen_salt(''bf'', 12))
     WHERE password_hash !~ %2$L
       AND password_hash !~ %3$L
       AND password_hash !~ %4$L',
    crypto_schema,
    '^\$',
    '^\*[0-9A-Fa-f]{40}$',
    '^([A-Fa-f0-9]{32}|[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64}|[A-Fa-f0-9]{96}|[A-Fa-f0-9]{128})$'
  );
END;
$$;
