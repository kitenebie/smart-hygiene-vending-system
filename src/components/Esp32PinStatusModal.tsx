import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';

let channelCounter = 0;

interface PinStatus {
  gpio: number;
  current_mode: string;
  connection_status: 'connected' | 'disconnected';
  realtime_value: string;
  updated_at: string;
}

const allEsp32Pins = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39,
];

interface Esp32PinStatusModalProps {
  onClose: () => void;
}

export default function Esp32PinStatusModal({ onClose }: Esp32PinStatusModalProps) {
  const [rows, setRows] = useState<PinStatus[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data, error } = await supabase
        .from('esp32_pin_status')
        .select('gpio,current_mode,connection_status,realtime_value,updated_at')
        .eq('machine_id', 'VM001')
        .order('gpio');
      if (!error && mounted) setRows((data ?? []) as PinStatus[]);
    };

    void load();
    channelCounter += 1;
    const channel = supabase
      .channel(`esp32-pin-status:${channelCounter}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'esp32_pin_status', filter: 'machine_id=eq.VM001',
      }, () => { void load(); })
      .subscribe();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      mounted = false;
      window.clearInterval(clock);
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const renderedRows = useMemo(() => allEsp32Pins
    .map(gpio => {
      const status = rows.find(row => row.gpio === gpio) ?? {
        gpio,
        current_mode: 'Waiting for ESP32',
        connection_status: 'disconnected' as const,
        realtime_value: '—',
        updated_at: '',
      };
      const connected = status.connection_status === 'connected'
        && Boolean(status.updated_at)
        && now - new Date(status.updated_at).getTime() < 15000;
      return { ...status, connected };
    })
    .sort((left, right) => Number(right.connected) - Number(left.connected) || left.gpio - right.gpio), [now, rows]);

  return (
    <div className="pin-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="pin-modal" role="dialog" aria-modal="true" aria-labelledby="pin-status-title" onMouseDown={event => event.stopPropagation()}>
        <header className="pin-modal-head">
          <div>
            <h2 id="pin-status-title" className="display">ESP32 Real-Time Hardware PIN Status</h2>
            <p>Connection probing runs only while this panel is enabled.</p>
          </div>
          <button className="pin-modal-close" type="button" onClick={onClose} aria-label="Close ESP32 PIN status">×</button>
        </header>
        <div className="pin-table-wrap">
          <table className="pin-status-table">
            <thead><tr><th>PIN Number</th><th>Current Mode</th><th>Connection Status</th><th>Real-Time Value</th></tr></thead>
            <tbody>
              {renderedRows.map(row => {
                const { connected } = row;
                return (
                  <tr key={row.gpio}>
                    <td><span className="pin-number">D{row.gpio}</span></td>
                    <td><span className="pin-mode">{row.current_mode}</span></td>
                    <td>{connected ? <span className="pin-badge connected"><span className="pin-pulse" />Device Connected</span> : <span className="pin-badge disconnected">No Device Connected</span>}</td>
                    <td className="pin-value">{connected ? row.realtime_value : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
