import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { supabase } from '../utils/supabase';
import { timeAgo } from '../utils/helpers';
import { useToast } from '../components/Toast';

interface SmsLog {
  id: number;
  machine_id: string;
  event_type: 'dispensed_product' | 'payment' | 'theft_alert' | 'low_stock';
  recipient: string;
  message: string;
  status: 'pending' | 'sent';
  attempt_count: number;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

const eventLabels: Record<SmsLog['event_type'], string> = {
  dispensed_product: 'Product dispensed',
  payment: 'Payment',
  theft_alert: 'Theft alert',
  low_stock: 'Low stock',
};

function attemptText(sms: SmsLog) {
  if (sms.status === 'sent') {
    return sms.sent_at ? `Sent ${timeAgo(sms.sent_at)}` : 'Sent';
  }
  if (sms.attempt_count === 0) return 'Queued for sending';
  return `Retry ${sms.attempt_count}${sms.last_attempt_at ? ` · ${timeAgo(sms.last_attempt_at)}` : ''}`;
}

export default function SmsLogsView() {
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const { showToast } = useToast();

  usePolling(load);
  useRealtimeRefresh(['sms'], load);

  async function load() {
    try {
      const { data, error } = await supabase
        .from('sms')
        .select('id,machine_id,event_type,recipient,message,status,attempt_count,last_attempt_at,last_error,created_at,sent_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setLogs((data ?? []) as SmsLog[]);
    } catch {
      showToast('Could not load SMS logs. Apply the SMS outbox migration first.', true);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title display">SMS delivery logs</div>
          <div className="panel-title-sub">Every SMS is queued to the configured admin phone number before the ESP32 sends it.</div>
        </div>
        <span className="sms-live"><span className="status-dot" /> Live</span>
      </div>
      <div className="table-scroll">
        <table className="slot-table tx-table sms-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Recipient</th>
              <th>Message</th>
              <th>Delivery</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(sms => (
              <tr key={sms.id}>
                <td>
                  <div className="sms-event">{eventLabels[sms.event_type] ?? sms.event_type}</div>
                  <div className="sms-machine mono">{sms.machine_id}</div>
                </td>
                <td className="mono">{sms.recipient}</td>
                <td>
                  <div className="sms-message">{sms.message}</div>
                  {sms.last_error && sms.status === 'pending' && (
                    <div className="sms-error">{sms.last_error}</div>
                  )}
                </td>
                <td>
                  <span className={`tag ${sms.status === 'sent' ? 'sent' : 'pending'}`}>
                    <span className="dot" /> {sms.status}
                  </span>
                  <div className="log-time">{attemptText(sms)}</div>
                </td>
                <td className="tx-time">{timeAgo(sms.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!logs.length && <div className="empty-note">No SMS events yet.</div>}
    </div>
  );
}
