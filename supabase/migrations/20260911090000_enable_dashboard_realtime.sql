-- Realtime dashboard listeners use these tables.  The block is safe to run more than once.
DO $$
DECLARE
  realtime_table text;
BEGIN
  FOREACH realtime_table IN ARRAY ARRAY[
    'admins',
    'device_health',
    'gcash_payments',
    'machine_health_logs',
    'machine_settings',
    'notifications',
    'slots',
    'transactions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = realtime_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', realtime_table);
    END IF;
  END LOOP;
END $$;
