import { supabase } from './supabase';

export async function loadReportedCoinBalance(): Promise<number | null> {
  const { data, error } = await supabase
    .from('esp32_logs')
    .select('message')
    .ilike('message', '%credit%')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const match = data?.message.match(/credit[= ]P?([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}

export async function requestCoinBalanceReset(): Promise<void> {
  const { error } = await supabase.rpc('request_coin_balance_reset');
  if (error) throw error;
}
