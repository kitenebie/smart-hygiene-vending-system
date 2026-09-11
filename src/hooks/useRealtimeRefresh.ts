import { useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';

/**
 * Refreshes the active view as soon as one of its backing tables changes.
 * Polling remains enabled in each view as a fallback for offline/reconnecting clients.
 */
export function useRealtimeRefresh(
  tables: readonly string[],
  refresh: () => Promise<void>,
  onConnectionChange?: (isActive: boolean) => void,
) {
  const refreshRef = useRef(refresh);
  const connectionChangeRef = useRef(onConnectionChange);
  const tableKey = tables.join('|');

  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    connectionChangeRef.current = onConnectionChange;
  });

  useEffect(() => {
    const subscribedTables = tableKey.split('|').filter(Boolean);
    // React Strict Mode briefly mounts an effect twice in development. A unique topic
    // prevents the second mount from reusing a channel that is still unsubscribing.
    const channelName = `dashboard-refresh:${tableKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let active = true;
    const channel = subscribedTables.reduce(
      (current, table) => current.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => { void refreshRef.current(); },
      ),
      supabase.channel(channelName),
    );

    channel.subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') {
        connectionChangeRef.current?.(true);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        connectionChangeRef.current?.(false);
        console.warn(`Realtime refresh unavailable for: ${subscribedTables.join(', ')}`);
      }
    });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [tableKey]);
}
