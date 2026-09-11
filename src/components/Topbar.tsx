interface TopbarProps {
  title: string;
  subtitle: string;
  realtimeActive: boolean;
}

export default function Topbar({ title, subtitle, realtimeActive }: TopbarProps) {
  return (
    <div className="topbar">
      <div>
        <div className="page-title display">{title}</div>
        <div className="page-sub">{subtitle}</div>
      </div>
      <div className="machine-pill">
        <div className={`status-dot${realtimeActive ? '' : ' inactive'}`} />
        <span className={`realtime-status${realtimeActive ? ' active' : ' inactive'}`}>
          {realtimeActive ? 'Realtime active' : 'Realtime not active'}
        </span>
      </div>
    </div>
  );
}
