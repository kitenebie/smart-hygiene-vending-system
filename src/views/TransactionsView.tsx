import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { supabase } from '../utils/supabase';
import { timeAgo, downloadCSV } from '../utils/helpers';
import SlotTag from '../components/SlotTag';
import { useToast } from '../components/Toast';

interface GcashPayment {
  id: number;
  ref_code: string;
  amount: number;
  slot_id: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  consumed_at: string | null;
  created_at: string;
  slots: { slot_code: string } | null;
}

interface Transaction {
  id: number;
  ref_code: string;
  method: 'gcash' | 'coin';
  amount: number;
  created_at: string;
  slots: { slot_code: string } | null;
}

export default function TransactionsView() {
  const [gcash, setGcash] = useState<GcashPayment[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const { showToast } = useToast();

  usePolling(loadAll);
  useRealtimeRefresh(['gcash_payments', 'notifications', 'transactions'], loadAll);

  async function loadAll() {
    await Promise.all([loadGcash(), loadTx()]);
  }

  async function loadGcash() {
    try {
      const { data, error } = await supabase
        .from('gcash_payments')
        .select('*, slots(slot_code)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setGcash((data ?? []) as GcashPayment[]);
    } catch {
      showToast('Could not load GCash approvals.', true);
    }
  }

  async function loadTx() {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, slots(slot_code)')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setTxs((data ?? []) as Transaction[]);
    } catch {
      showToast('Could not load transactions.', true);
    }
  }

  async function resolveGcash(id: number, action: 'approve' | 'reject') {
    try {
      const payment = gcash.find(g => g.id === id);
      if (!payment) return;

      const resolvedAt = new Date().toISOString();
      const { data: resolved, error } = await supabase
        .from('gcash_payments')
        .update({ status: action === 'approve' ? 'approved' : 'rejected', resolved_at: resolvedAt })
        .eq('id', id)
        .eq('status', 'pending')
        .is('consumed_at', null)
        .select('id');
      if (error) throw error;
      if (!resolved?.length) {
        showToast('This payment was already resolved.');
        await loadAll();
        return;
      }

      await supabase.from('notifications').insert({
        type: 'gcash',
        level: action === 'approve' ? 'info' : 'warning',
        message: action === 'approve'
          ? `GCash reference ${payment.ref_code} approved — dispense allowed`
          : `GCash reference ${payment.ref_code} rejected — no matching SMS found`,
      });

      showToast(action === 'approve' ? 'GCash reference approved.' : 'GCash reference rejected.');
      loadAll();
    } catch {
      showToast('Could not update payment.', true);
    }
  }

  function exportCSV() {
    downloadCSV(
      txs.map(t => ({
        ref_code: t.ref_code,
        method: t.method,
        slot: (t.slots as { slot_code: string } | null)?.slot_code ?? '',
        amount: Number(t.amount).toFixed(2),
        created_at: t.created_at,
      })),
      '4peace_transactions.csv',
    );
  }

  return (
    <div>
      {/* GCash approvals */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title display">GCash approvals</div>
            <div className="panel-title-sub">Confirm each reference number against the SMS your SIM800L receives</div>
          </div>
        </div>
        <table className="slot-table gcash-table">
          <thead>
            <tr><th>Reference</th><th>Slot</th><th>Amount</th><th>Time</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {gcash.length ? gcash.map(g => (
              <tr key={g.id}>
                <td className="slot-id">{g.ref_code}</td>
                <td className="slot-id">{(g.slots as { slot_code: string } | null)?.slot_code ?? '—'}</td>
                <td className="tx-amount">₱{Number(g.amount).toFixed(2)}</td>
                <td className="tx-time">{timeAgo(g.created_at)}</td>
                <td><SlotTag status={g.consumed_at ? 'consumed' : g.status} /></td>
                <td>
                  {g.status === 'pending' && !g.consumed_at && (
                    <div className="gcash-actions">
                      <button className="btn small approve" onClick={() => resolveGcash(g.id, 'approve')}>Approve</button>
                      <button className="btn small reject" onClick={() => resolveGcash(g.id, 'reject')}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="empty-note">No GCash references submitted yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent transactions */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title display">Recent transactions</div>
            <div className="panel-title-sub">Every dispense confirmed by an IR sensor is logged here</div>
          </div>
          <button className="btn ghost" onClick={exportCSV}>Export CSV</button>
        </div>
        <table className="slot-table tx-table">
          <thead>
            <tr><th>Ref / Pulse ID</th><th>Method</th><th>Slot</th><th>Amount</th><th>Time</th></tr>
          </thead>
          <tbody>
            {txs.length ? txs.map(t => (
              <tr key={t.id}>
                <td className="slot-id">{t.ref_code}</td>
                <td>
                  <div className="tx-method">
                    <div className={`method-chip ${t.method}`}>{t.method === 'gcash' ? 'G' : '₱'}</div>
                    {t.method === 'gcash' ? 'GCash' : 'Coin'}
                  </div>
                </td>
                <td className="slot-id">{(t.slots as { slot_code: string } | null)?.slot_code ?? '—'}</td>
                <td className="tx-amount">₱{Number(t.amount).toFixed(2)}</td>
                <td className="tx-time">{timeAgo(t.created_at)}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="empty-note">No transactions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
