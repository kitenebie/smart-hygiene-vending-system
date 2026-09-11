import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import OverviewView from '../views/OverviewView';
import SlotsView from '../views/SlotsView';
import TransactionsView from '../views/TransactionsView';
import HealthView from '../views/HealthView';
import NotificationsView from '../views/NotificationsView';
import SmsLogsView from '../views/SmsLogsView';
import SettingsView from '../views/SettingsView';
import { supabase } from '../utils/supabase';
import { usePolling } from '../hooks/usePolling';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

type View = 'overview' | 'slots' | 'transactions' | 'health' | 'notifications' | 'sms_logs' | 'settings';

const titles: Record<View, [string, string]> = {
  overview:      ['Overview', 'Snapshot of the machine right now'],
  slots:         ['Slots & Inventory', 'Live stock levels for every dispensing slot'],
  transactions:  ['Transactions', 'GCash and coin payments confirmed by the machine'],
  health:        ['Device Health', 'Real-time sensor and power diagnostics'],
  notifications: ['Notifications', 'Stock, coin box, tamper, GCash and system alerts'],
  sms_logs:      ['SMS Logs', 'Real-time queue and delivery history for the admin phone number'],
  settings:      ['Settings', 'Your account and machine configuration'],
};

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [unreadCount, setUnreadCount] = useState(0);
  const [realtimeActive, setRealtimeActive] = useState(false);

  const requestedView = searchParams.get('view');
  const activeView: View = requestedView && requestedView in titles
    ? requestedView as View
    : 'overview';

  const setActiveView = (view: View) => {
    setSearchParams(view === 'overview' ? {} : { view });
  };

  usePolling(loadBadge, 20000);
  useRealtimeRefresh(['notifications'], loadBadge, setRealtimeActive);

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
        <Topbar title={title} subtitle={subtitle} realtimeActive={realtimeActive} />
        <div className="content">
          {activeView === 'overview' && <OverviewView />}
          {activeView === 'slots' && <SlotsView />}
          {activeView === 'transactions' && <TransactionsView />}
          {activeView === 'health' && <HealthView />}
          {activeView === 'notifications' && <NotificationsView onUnreadChange={handleUnreadChange} />}
          {activeView === 'sms_logs' && <SmsLogsView />}
          {activeView === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
