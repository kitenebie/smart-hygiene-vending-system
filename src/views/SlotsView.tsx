import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { supabase } from '../utils/supabase';
import { slotStatus, statusMeta } from '../utils/helpers';
import SlotTag from '../components/SlotTag';
import { useToast } from '../components/Toast';

interface Slot {
  id: number;
  slot_code: string;
  product_name: string;
  stock: number;
  capacity: number;
  status: 'ok' | 'low' | 'empty';
}

export default function SlotsView() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [restockSlot, setRestockSlot] = useState<Slot | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  usePolling(load);
  useRealtimeRefresh(['machine_settings', 'slots'], load);

  async function load() {
    try {
      const { data: settings } = await supabase
        .from('machine_settings')
        .select('low_stock_threshold')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      const threshold = settings?.low_stock_threshold ?? 5;

      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .order('slot_code');
      if (error) throw error;
      setSlots((data ?? []).map(s => ({ ...s, status: slotStatus(s.stock, threshold) })));
    } catch {
      showToast('Could not load slots.', true);
    }
  }

  function openRestock(slot: Slot) {
    setRestockSlot(slot);
    setQuantity('1');
  }

  async function addStock() {
    if (!restockSlot) return;
    const amount = Number.parseInt(quantity, 10);
    const availableSpace = restockSlot.capacity - restockSlot.stock;

    if (!Number.isInteger(amount) || amount <= 0) {
      showToast('Enter a valid stock quantity.', true);
      return;
    }
    if (amount > availableSpace) {
      showToast(`Only ${availableSpace} item(s) fit in ${restockSlot.slot_code}.`, true);
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('restock_slot', {
        p_slot_id: restockSlot.id,
        p_quantity: amount,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message ?? 'Restock was rejected.');

      showToast(`${data.added} item(s) added to ${restockSlot.slot_code}. Stock: ${data.stock}/${data.capacity}.`);
      setRestockSlot(null);
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not add stock.', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <div className="machine-view">
        {/* Visual rack */}
        <div className="machine-rack">
          <div className="rack-frame">
            {slots.map(s => {
              const pct = Math.round((s.stock / s.capacity) * 100);
              const meta = statusMeta[s.status];
              return (
                <div className="rack-slot" key={s.slot_code}>
                  <div className="rack-fill" style={{ width: `${pct}%`, background: meta.color }} />
                  <span>{s.slot_code} {pct}%</span>
                </div>
              );
            })}
          </div>
          <div className="rack-slot-lcd">
            READY · INSERT COIN OR<br />SCAN GCASH TO DISPENSE
          </div>
          <div className="rack-label">
            Physical layout mirrors the<br />ESP32 slot wiring order
          </div>
        </div>

        {/* Table */}
        <div>
          <table className="slot-table">
            <thead>
              <tr><th>Slot</th><th>Product</th><th>Stock</th><th>Level</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {slots.map(s => {
                const pct = Math.round((s.stock / s.capacity) * 100);
                const meta = statusMeta[s.status];
                return (
                  <tr key={s.slot_code}>
                    <td className="slot-id">{s.slot_code}</td>
                    <td>{s.product_name}</td>
                    <td className="mono">{s.stock} / {s.capacity}</td>
                    <td>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%`, background: meta.color }} />
                      </div>
                    </td>
                    <td><SlotTag status={s.status} /></td>
                    <td>
                      <button className="btn small" type="button" disabled={s.stock >= s.capacity} onClick={() => openRestock(s)}>
                        {s.stock >= s.capacity ? 'Full' : 'Add stock'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {restockSlot && (
        <div className="stock-modal-backdrop" role="presentation" onMouseDown={() => !saving && setRestockSlot(null)}>
          <section className="stock-modal" role="dialog" aria-modal="true" aria-labelledby="restock-title" onMouseDown={event => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="restock-title" className="display">Add stock — {restockSlot.slot_code}</h2>
                <p>{restockSlot.product_name} currently has {restockSlot.stock} of {restockSlot.capacity} items.</p>
              </div>
              <button className="pin-modal-close" type="button" onClick={() => setRestockSlot(null)} disabled={saving} aria-label="Close add stock dialog">×</button>
            </header>
            <form onSubmit={event => { event.preventDefault(); void addStock(); }}>
              <label htmlFor="stock-quantity">Quantity to add</label>
              <input
                id="stock-quantity"
                className="input mono"
                type="number"
                min="1"
                max={restockSlot.capacity - restockSlot.stock}
                value={quantity}
                onChange={event => setQuantity(event.target.value)}
                autoFocus
              />
              <div className="field-hint">Maximum: {restockSlot.capacity - restockSlot.stock} item(s)</div>
              <div className="stock-modal-actions">
                <button className="btn ghost" type="button" onClick={() => setRestockSlot(null)} disabled={saving}>Cancel</button>
                <button className="btn" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add stock'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
