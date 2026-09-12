interface TopbarProps {
  title: string;
  subtitle: string;
  esp32Connected: boolean;
  lastSync: string | null;
}

function syncText(lastSync: string | null) {
  if (!lastSync) return 'No telemetry received yet';

  const seconds = Math.max(0, Math.floor((Date.now() - new Date(lastSync).getTime()) / 1000));
  if (seconds < 60) return 'synced just now';
  return `last sync ${Math.floor(seconds / 60)} min ago`;
}

export default function Topbar({ title, subtitle, esp32Connected, lastSync }: TopbarProps) {
  const label = esp32Connected
    ? `ESP32 connected · ${syncText(lastSync)}`
    : 'Waiting for ESP32';

  return (
    <div className="topbar">
      <div>
        <div className="page-title display">{title}</div>
        <div className="page-sub">{subtitle}</div>
      </div>
      <div className="machine-pill" title={syncText(lastSync)}>
        <div className={`status-dot${esp32Connected ? '' : ' inactive'}`} />
        <span className={`esp32-status${esp32Connected ? ' connected' : ' waiting'}`}>
          {label}
        </span>
      </div>
    </div>
  );
}
