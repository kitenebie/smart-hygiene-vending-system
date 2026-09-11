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
              <tr><th>Slot</th><th>Product</th><th>Stock</th><th>Level</th><th>Status</th></tr>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
