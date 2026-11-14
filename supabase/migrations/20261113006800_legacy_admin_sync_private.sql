-- Keep legacy credentials and sync metadata out of browser-accessible roles.
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supabase_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ALTER COLUMN password_hash DROP DEFAULT;

REVOKE ALL ON TABLE public.admins, public.supabase_sync_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.admins_id_seq FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
