export default function StatCard({ label, value, delta, deltaDown }) {
    return (<div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{value}</div>
      {delta !== undefined && (<div className={`stat-delta${deltaDown ? ' down' : ''}`}>{delta}</div>)}
    </div>);
}
