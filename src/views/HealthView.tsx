import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import { supabase } from '../utils/supabase';
import { formatUptime, timeAgo, levelMeta } from '../utils/helpers';
import { useToast } from '../components/Toast';

interface Metric { name: string; value: string; pct: number; status: 'ok' | 'warn' | 'crit' | 'accent' }
interface LogEntry { level: 'info' | 'warning' | 'critical'; text: string; time: string }

export default function HealthView() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const { showToast } = useToast();

  usePolling(load);

  async function load() {
    try {
      const { data: h } = await supabase
        .from('device_health')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: logRows } = await supabase
        .from('machine_health_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (h) {
        setMetrics([
          { name: 'ESP32 Uptime', value: formatUptime(h.esp32_uptime_seconds), pct: 92, status: 'ok' },
          { name: 'Coin pulses (session)', value: String(h.coin_pulses_session), pct: Math.min(100, h.coin_pulses_session), status: 'accent' },
          { name: 'SIM800L Signal', value: h.sim800l_signal_pct >= 50 ? 'Good' : 'Weak', pct: h.sim800l_signal_pct, status: h.sim800l_signal_pct >= 50 ? 'ok' : 'warn' },
          { name: '5V Rail (Buck #1)', value: Number(h.buck1_voltage).toFixed(2) + 'V', pct: 96, status: 'ok' },
          { name: '4.2V Rail (Buck #2)', value: Number(h.buck2_voltage).toFixed(2) + 'V', pct: 88, status: 'ok' },
          { name: 'Tamper sensor', value: h.tamper_status === 'idle' ? 'Idle' : 'TRIGGERED', pct: 100, status: h.tamper_status === 'idle' ? 'ok' : 'crit' },
        ]);
      }

      setLogs((logRows ?? []).map(l => ({
        level: l.level as 'info' | 'warning' | 'critical',
        text: l.message,
        time: timeAgo(l.created_at),
      })));
    } catch {
      showToast('Could not load device health.', true);
    }
  }

  const statusColor = (status: Metric['status']) => {
    if (status === 'ok') return 'var(--sage)';
    if (status === 'warn') return 'var(--amber)';
    if (status === 'crit') return 'var(--rust)';
    return 'var(--clay)';
  };

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title display">Device health</div>
            <div className="panel-title-sub">Live readings from onboard sensors</div>
          </div>
        </div>
        <div className="health-grid">
          {metrics.map(m => {
            const color = statusColor(m.status);
            return (
              <div className="health-card" key={m.name}>
                <div className="health-top">
                  <div className="health-name">{m.name}</div>
                  <div className="pulse" style={{ background: color, color }} />
                </div>
                <div className="health-metric">{m.value}</div>
                <div className="health-bar">
                  <div className="health-bar-fill" style={{ width: `${m.pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title display">Machine health log</div>
            <div className="panel-title-sub">Alerts saved to machine_health_logs</div>
          </div>
        </div>
        <div className="log-list">
          {logs.length ? logs.map((l, i) => {
            const meta = levelMeta[l.level] ?? levelMeta.info;
            return (
              <div className="log-row" key={i}>
                <div className="log-icon" style={{ background: meta.bg, color: meta.color }}>{meta.icon}</div>
                <div>
                  <div className="log-text">{l.text}</div>
                  <div className="log-time">{l.time}</div>
                </div>
              </div>
            );
          }) : <div className="empty-note">No log entries yet.</div>}
        </div>
      </div>
    </div>
  );
}
