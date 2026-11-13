-- Keep profile editing available while reserving role changes for trusted provisioning.
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'Machine Technician';

REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (role) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (username, full_name, phone, last_login)
  ON TABLE public.profiles TO authenticated;
