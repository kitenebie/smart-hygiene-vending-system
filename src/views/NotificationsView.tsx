import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { supabase } from '../utils/supabase';
import { timeAgo, levelMeta } from '../utils/helpers';
import { useToast } from '../components/Toast';

interface Notification {
  id: number;
  type: string;
  level: 'info' | 'warning' | 'critical';
  message: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationsViewProps {
  onUnreadChange: (count: number) => void;
}

export default function NotificationsView({ onUnreadChange }: NotificationsViewProps) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const { showToast } = useToast();

  usePolling(load);

  async function load() {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setNotifs(data ?? []);
      onUnreadChange((data ?? []).filter(n => !n.is_read).length);
    } catch {
      showToast('Could not load notifications.', true);
    }
  }

  async function markAllRead() {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('is_read', false);
      if (error) throw error;
      load();
    } catch {
      showToast('Could not mark as read.', true);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title display">All notifications</div>
          <div className="panel-title-sub">Stock, coin box, tamper, GCash and system alerts from the machine</div>
        </div>
        <button className="btn ghost" onClick={markAllRead}>Mark all as read</button>
      </div>
      <div className="log-list">
        {notifs.length ? notifs.map(n => {
          const meta = levelMeta[n.level] ?? levelMeta.info;
          return (
            <div className={`log-row${n.is_read ? '' : ' unread'}`} key={n.id}>
              <div className="log-icon" style={{ background: meta.bg, color: meta.color }}>{meta.icon}</div>
              <div style={{ flex: 1 }}>
                <div className="log-text">{n.message}</div>
                <div className="log-time">{timeAgo(n.created_at)}</div>
              </div>
              {!n.is_read && <div className="unread-dot" />}
            </div>
          );
        }) : <div className="empty-note">No notifications yet.</div>}
      </div>
    </div>
  );
}
