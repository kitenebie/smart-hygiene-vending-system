import { useEffect, useState } from 'react';

type View = 'overview' | 'slots' | 'transactions' | 'health' | 'notifications' | 'sms_logs' | 'esp32_logs' | 'settings';

interface SidebarProps {
  activeView: View;
  onNav: (v: View) => void;
  unreadCount: number;
}

const navItems: { view: View; label: string; icon: React.ReactNode }[] = [
  {
    view: 'overview',
    label: 'Overview',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="8" height="8" rx="1.5"/>
        <rect x="13" y="3" width="8" height="5" rx="1.5"/>
        <rect x="13" y="10" width="8" height="11" rx="1.5"/>
        <rect x="3" y="13" width="8" height="8" rx="1.5"/>
      </svg>
    ),
  },
  {
    view: 'slots',
    label: 'Slots & Inventory',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="3" width="16" height="18" rx="2"/>
        <line x1="4" y1="9" x2="20" y2="9"/>
        <line x1="4" y1="15" x2="20" y2="15"/>
      </svg>
    ),
  },
  {
    view: 'transactions',
    label: 'Transactions',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 10h18M7 15h1M12 15h1"/>
        <rect x="3" y="6" width="18" height="13" rx="2"/>
      </svg>
    ),
  },
  {
    view: 'health',
    label: 'Device Health',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12h4l2 7 4-14 2 7h6"/>
      </svg>
    ),
  },
  {
    view: 'notifications',
    label: 'Notifications',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    ),
  },
  {
    view: 'sms_logs',
    label: 'SMS Logs',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 9.46 9.46 0 0 1-4.78-1.28L3 20l1.38-3.68A8.48 8.48 0 0 1 3 11.5a8.5 8.5 0 0 1 17 0Z"/>
        <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth="2.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    view: 'esp32_logs',
    label: 'ESP32 Logs',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 9h8M8 13h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/>
      </svg>
    ),
  },
  {
    view: 'settings',
    label: 'Settings',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.4.65.75.8"/>
      </svg>
    ),
  },
];

export default function Sidebar({ activeView, onNav, unreadCount }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  return (
    <>
      <button
        type="button"
        className={`menu-toggle${menuOpen ? ' open' : ''}`}
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}
      >
        <span /><span /><span />
      </button>
      {menuOpen && <button type="button" className="menu-backdrop" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar${menuOpen ? ' menu-open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <div className="brand-glyph">4P</div>
          <div>
            <div className="brand-name">4Peace</div>
            <div className="brand-sub">MACHINE ADMIN</div>
          </div>
        </div>
      </div>

      <nav className="nav">
        {navItems.map(({ view, label, icon }) => (
          <button
            key={view}
            className={`nav-item${activeView === view ? ' active' : ''}`}
            onClick={() => {
              onNav(view);
              setMenuOpen(false);
            }}
          >
            {icon}
            <span>{label}</span>
            {view === 'notifications' && unreadCount > 0 && (
              <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="status-dot" />
        <span>Unit #001 — Online</span>
      </div>
      </aside>
    </>
  );
}
