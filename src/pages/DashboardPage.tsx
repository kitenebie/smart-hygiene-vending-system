import { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import OverviewView from '../views/OverviewView';
import SlotsView from '../views/SlotsView';
import TransactionsView from '../views/TransactionsView';
import HealthView from '../views/HealthView';
import NotificationsView from '../views/NotificationsView';
import SettingsView from '../views/SettingsView';
import { supabase } from '../utils/supabase';

type View = 'overview' | 'slots' | 'transactions' | 'health' | 'notifications' | 'settings';

const titles: Record<View, [string, string]> = {
  overview:      ['Overview', 'Snapshot of the machine right now'],
  slots:         ['Slots & Inventory', 'Live stock levels for every dispensing slot'],
  transactions:  ['Transactions', 'GCash and coin payments confirmed by the machine'],
  health:        ['Device Health', 'Real-time sensor and power diagnostics'],
  notifications: ['Notifications', 'Stock, coin box, tamper, GCash and system alerts'],
  settings:      ['Settings', 'Your account and machine configuration'],
};

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<View>('overview');
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Poll unread notifications every 20 s
  useEffect(() => {
    loadBadge();
    const id = setInterval(loadBadge, 20000);
    return () => clearInterval(id);
  }, []);

  async function loadBadge() {
    const { data } = await supabase
      .from('notifications')
      .select('id')
      .eq('is_read', false);
    setUnreadCount(data?.length ?? 0);
  }

  const handleUnreadChange = useCallback((count: number) => {
    setUnreadCount(count);
    // refresh badge after mark-all-read too
  }, []);

  const [title, subtitle] = titles[activeView];

  return (
    <div className="app">
      <Sidebar activeView={activeView} onNav={setActiveView} unreadCount={unreadCount} />
      <main className="main">
        <Topbar title={title} subtitle={subtitle} lastSync={lastSync} />
        <div className="content">
          {activeView === 'overview' && <OverviewView onSyncChange={setLastSync} />}
          {activeView === 'slots' && <SlotsView />}
          {activeView === 'transactions' && <TransactionsView />}
          {activeView === 'health' && <HealthView />}
          {activeView === 'notifications' && <NotificationsView onUnreadChange={handleUnreadChange} />}
          {activeView === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
