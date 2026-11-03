-- Additive Supabase Auth migration. Legacy password values cannot be imported as Auth passwords.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE CHECK (char_length(btrim(username)) BETWEEN 1 AND 50),
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'Administrator' CHECK (role IN ('Administrator', 'Machine Technician')),
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles: read own" ON public.profiles;
CREATE POLICY "profiles: read own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS "profiles: update own" ON public.profiles;
CREATE POLICY "profiles: update own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Retain the imported legacy account record for audit only. Dashboard users
-- authenticate through auth.users and profiles, never through password_hash.
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admins FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_profile_for_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, phone)
  VALUES (NEW.id, COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), ''), split_part(NEW.email, '@', 1)), COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''), NULLIF(btrim(NEW.raw_user_meta_data ->> 'phone'), ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_profile_for_auth_user ON auth.users;
CREATE TRIGGER create_profile_for_auth_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_profile_for_auth_user();

-- Link pre-existing Auth users only after identity verification:
-- INSERT INTO public.profiles (id, username, full_name, phone, role) VALUES ('<auth-user-uuid>', 'admin', 'Admin name', '+63...', 'Administrator');
NOTIFY pgrst, 'reload schema';
