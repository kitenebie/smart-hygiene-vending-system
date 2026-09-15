import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { supabase } from '../utils/supabase';
import { timeAgo } from '../utils/helpers';
import { useToast } from '../components/Toast';

interface Esp32Log {
  id: number;
  machine_id: string;
  level: 'info' | 'warning' | 'error';
  category: string;
  message: string;
  created_at: string;
}

export default function Esp32LogsView() {
  const [logs, setLogs] = useState<Esp32Log[]>([]);
  const { showToast } = useToast();

  usePolling(load, 15000);
  useRealtimeRefresh(['esp32_logs'], load);

  async function load() {
    try {
      const { data, error } = await supabase
        .from('esp32_logs')
        .select('id,machine_id,level,category,message,created_at')
        .eq('machine_id', 'VM001')
        .order('created_at', { ascending: false })
        .limit(250);
      if (error) throw error;
      setLogs((data ?? []) as Esp32Log[]);
    } catch {
      showToast('Could not load ESP32 logs. Apply the ESP32 event-log migration first.', true);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title display">ESP32 logs</div>
          <div className="panel-title-sub">Server-timestamped Wi-Fi, Supabase, LCD, payment, relay, and sensor events.</div>
        </div>
        <span className="sms-live"><span className="status-dot" /> Live</span>
      </div>
      <div className="table-scroll">
        <table className="slot-table tx-table sms-table">
          <thead><tr><th>Timestamp</th><th>Category</th><th>Event</th><th>Level</th></tr></thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td className="tx-time" title={new Date(log.created_at).toLocaleString()}>{timeAgo(log.created_at)}</td>
                <td><span className="sms-event mono">{log.category}</span><div className="sms-machine mono">{log.machine_id}</div></td>
                <td><div className="sms-message">{log.message}</div></td>
                <td><span className={`tag ${log.level === 'error' ? 'failed' : log.level === 'warning' ? 'pending' : 'sent'}`}><span className="dot" /> {log.level}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!logs.length && <div className="empty-note">No ESP32 events yet.</div>}
    </div>
  );
}
