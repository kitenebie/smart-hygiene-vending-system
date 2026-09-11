import { useState } from 'react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { usePolling } from '../hooks/usePolling';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { supabase } from '../utils/supabase';
import { formatUptime, timeAgo, levelMeta } from '../utils/helpers';
import { useToast } from '../components/Toast';

interface Metric { name: string; value: string; pct: number; status: 'ok' | 'warn' | 'crit' | 'accent' }
interface LogEntry { level: 'info' | 'warning' | 'critical'; text: string; time: string }
interface ResourceSample {
  internal_sram_free_bytes: number;
  external_psram_free_bytes: number;
  external_flash_total_bytes: number;
  external_flash_used_bytes: number;
  filesystem_total_bytes: number;
  filesystem_used_bytes: number;
  rom_total_bytes: number;
  cpu_temperature_c: number | null;
  collected_at: string;
}

const toKiB = (bytes: number) => Math.round(Number(bytes ?? 0) / 1024);
const formatBytes = (bytes: number) => {
  const value = Number(bytes ?? 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
};
const timeLabel = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export default function HealthView() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [resources, setResources] = useState<ResourceSample[]>([]);
  const { showToast } = useToast();

  usePolling(load);
  useRealtimeRefresh(['device_health', 'device_resource_logs', 'machine_health_logs'], load);

  async function load() {
    try {
      const [{ data: h, error: healthError }, { data: logRows, error: logsError }, { data: resourceRows, error: resourcesError }] = await Promise.all([
        supabase.from('device_health').select('*').order('id', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('machine_health_logs').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('device_resource_logs').select('*').order('collected_at', { ascending: false }).limit(60),
      ]);
      if (healthError || logsError || resourcesError) throw healthError ?? logsError ?? resourcesError;

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

      setLogs((logRows ?? []).map(log => ({
        level: log.level as LogEntry['level'], text: log.message, time: timeAgo(log.created_at),
      })));
      setResources((resourceRows ?? []) as ResourceSample[]);
    } catch {
      showToast('Could not load device health telemetry.', true);
    }
  }

  const statusColor = (status: Metric['status']) => {
    if (status === 'ok') return 'var(--sage)';
    if (status === 'warn') return 'var(--amber)';
    if (status === 'crit') return 'var(--rust)';
    return 'var(--clay)';
  };

  const history = [...resources].reverse();
  const latestResources = resources[0];
  const memoryOptions: ApexOptions = {
    chart: { type: 'line', background: 'transparent', foreColor: '#9b939e', toolbar: { show: false }, zoom: { enabled: false } },
    colors: ['#8fb389', '#0072de'], stroke: { curve: 'smooth', width: 3 }, dataLabels: { enabled: false },
    grid: { borderColor: '#252229', strokeDashArray: 3 }, xaxis: { categories: history.map(sample => timeLabel(sample.collected_at)) },
    yaxis: { title: { text: 'Free memory (KiB)' }, labels: { formatter: value => `${Math.round(value)} KiB` } },
    legend: { position: 'top', horizontalAlign: 'right', labels: { colors: '#f1ece6' } },
    tooltip: { theme: 'dark', y: { formatter: value => `${value.toFixed(0)} KiB free` } },
  };
  const memorySeries = [
    { name: 'Internal SRAM', data: history.map(sample => toKiB(sample.internal_sram_free_bytes)) },
    { name: 'External PSRAM', data: history.map(sample => toKiB(sample.external_psram_free_bytes)) },
  ];

  const temperatureHistory = history.filter(sample => sample.cpu_temperature_c !== null);
  const temperatureOptions: ApexOptions = {
    chart: { type: 'line', background: 'transparent', foreColor: '#9b939e', toolbar: { show: false }, zoom: { enabled: false } },
    colors: ['#e0ab4c'], stroke: { curve: 'smooth', width: 3 }, dataLabels: { enabled: false },
    grid: { borderColor: '#252229', strokeDashArray: 3 }, xaxis: { categories: temperatureHistory.map(sample => timeLabel(sample.collected_at)) },
    yaxis: { title: { text: 'Temperature (°C)' }, labels: { formatter: value => `${value.toFixed(1)}°C` } },
    tooltip: { theme: 'dark', y: { formatter: value => `${value.toFixed(1)}°C` } },
  };
  const temperatureSeries = [{ name: 'Internal CPU temperature', data: temperatureHistory.map(sample => Number(sample.cpu_temperature_c)) }];

  const externalFlashFree = latestResources
    ? Math.max(0, latestResources.external_flash_total_bytes - latestResources.external_flash_used_bytes - latestResources.filesystem_total_bytes)
    : 0;
  const storageOptions: ApexOptions = {
    chart: { type: 'donut', background: 'transparent', foreColor: '#9b939e' }, colors: ['#645f6a', '#d97b93', '#8fb389', '#0072de', '#e0ab4c'],
    labels: ['Internal flash (not present)', 'Firmware in external flash', 'File system partition', 'Available external flash', 'ROM'],
    stroke: { colors: ['#151318'], width: 2 }, dataLabels: { enabled: true, formatter: value => `${Number(value).toFixed(0)}%` },
    legend: { position: 'bottom', labels: { colors: '#f1ece6' } }, tooltip: { theme: 'dark', y: { formatter: value => formatBytes(value) } },
  };
  const storageSeries = latestResources ? [
    0, latestResources.external_flash_used_bytes, latestResources.filesystem_total_bytes,
    externalFlashFree, latestResources.rom_total_bytes,
  ] : [];

  return (
    <div>
      <div className="panel">
        <div className="panel-head"><div><div className="panel-title display">Device health</div><div className="panel-title-sub">Live readings from onboard sensors</div></div></div>
        <div className="health-grid">
          {metrics.map(metric => {
            const color = statusColor(metric.status);
            return <div className="health-card" key={metric.name}><div className="health-top"><div className="health-name">{metric.name}</div><div className="pulse" style={{ background: color, color }} /></div><div className="health-metric">{metric.value}</div><div className="health-bar"><div className="health-bar-fill" style={{ width: `${metric.pct}%`, background: color }} /></div></div>;
          })}
        </div>
      </div>

      <div className="charts-grid-2">
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title display">Memory availability</div><div className="panel-title-sub">Internal SRAM and external PSRAM free memory</div></div></div>
          <div className="chart-body">{history.length ? <Chart options={memoryOptions} series={memorySeries} type="line" height={260} /> : <div className="empty-note">Waiting for the first ESP32 telemetry sample.</div>}</div>
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title display">Storage &amp; ROM</div><div className="panel-title-sub">Firmware, file system, available external flash, and ROM capacity</div></div></div>
          <div className="chart-body">{latestResources ? <Chart options={storageOptions} series={storageSeries} type="donut" height={260} /> : <div className="empty-note">Waiting for the first ESP32 telemetry sample.</div>}</div>
          {latestResources && <div className="health-resource-note">Internal flash: not present on ESP32-WROOM; firmware uses external SPI flash. File system used: {formatBytes(latestResources.filesystem_used_bytes)}.</div>}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><div><div className="panel-title display">ESP32 internal CPU temperature</div><div className="panel-title-sub">On-chip temperature sensor history</div></div></div>
        <div className="chart-body">{temperatureHistory.length ? <Chart options={temperatureOptions} series={temperatureSeries} type="line" height={260} /> : <div className="empty-note">Waiting for a CPU-temperature telemetry sample.</div>}</div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><div><div className="panel-title display">Machine health log</div><div className="panel-title-sub">Alerts saved to machine_health_logs</div></div></div>
        <div className="log-list">
          {logs.length ? logs.map((log, index) => {
            const meta = levelMeta[log.level] ?? levelMeta.info;
            return <div className="log-row" key={index}><div className="log-icon" style={{ background: meta.bg, color: meta.color }}>{meta.icon}</div><div><div className="log-text">{log.text}</div><div className="log-time">{log.time}</div></div></div>;
          }) : <div className="empty-note">No log entries yet.</div>}
        </div>
      </div>
    </div>
  );
}
