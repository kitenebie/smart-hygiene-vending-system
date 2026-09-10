import { timeAgo } from '../utils/helpers';

interface TopbarProps {
  title: string;
  subtitle: string;
  lastSync: string | null;
}

export default function Topbar({ title, subtitle, lastSync }: TopbarProps) {
  const syncLabel = lastSync ? 'Last sync: ' + timeAgo(lastSync) : 'Awaiting first sync';
  return (
    <div className="topbar">
      <div>
        <div className="page-title display">{title}</div>
        <div className="page-sub">{subtitle}</div>
      </div>
      <div className="machine-pill">
        <div className="status-dot" />
        <span>{syncLabel}</span>
      </div>
    </div>
  );
}
