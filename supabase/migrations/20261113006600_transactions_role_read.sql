-- Keep transaction history available to authorized app profiles only.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.transactions_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transactions TO authenticated;

DROP POLICY IF EXISTS "transactions: read profile" ON public.transactions;
CREATE POLICY "transactions: read profile"
  ON public.transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('Administrator', 'Machine Technician')
  ));

-- Preserve the existing firmware RPC contract while allowing its transaction insert.
ALTER FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) SECURITY DEFINER;
ALTER FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) SET search_path = '';
REVOKE ALL ON FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_vend(text, text, text, text, text, bigint, numeric) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
