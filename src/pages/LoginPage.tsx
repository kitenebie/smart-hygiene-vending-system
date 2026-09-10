import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Apply login page background class to body
  useEffect(() => {
    document.body.classList.add('login-body');
    return () => document.body.classList.remove('login-body');
  }, []);

  if (admin) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }
    setLoading(true);
    const res = await login(username, password);
    setLoading(false);
    if (res.success) {
      navigate('/', { replace: true });
    } else {
      setError(res.error || 'Invalid username or password.');
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-glyph">4P</div>
          <div>
            <div className="brand-name display">4Peace</div>
            <div className="brand-sub">MACHINE ADMIN</div>
          </div>
        </div>

        <h1 className="login-title display">Welcome back</h1>
        <p className="login-sub">Log in to manage slots, transactions, and machine settings.</p>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            name="username"
            className="input"
            placeholder="admin"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoFocus
          />

          <label className="field-label" htmlFor="password" style={{ marginTop: 14 }}>Password</label>
          <input
            type="password"
            id="password"
            name="password"
            className="input"
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          <button type="submit" className="btn login-submit" disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <div className="login-foot">Team 4Peace · Veritas College of Irosin</div>
      </div>
    </div>
  );
}
