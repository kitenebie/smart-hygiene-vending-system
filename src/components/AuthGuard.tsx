import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ color: 'var(--text-soft)', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
