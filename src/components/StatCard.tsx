interface StatCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaDown?: boolean;
}

export default function StatCard({ label, value, delta, deltaDown }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{value}</div>
      {delta !== undefined && (
        <div className={`stat-delta${deltaDown ? ' down' : ''}`}>{delta}</div>
      )}
    </div>
  );
}
