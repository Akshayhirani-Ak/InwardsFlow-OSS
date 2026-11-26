// InwardsFlow Enterprise WMS â€” Supabase Realtime Container Hook
// InwardsFlow Receiving & Inventory Engine
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useContainerRealtime(onUpdate: () => void, containerId?: string) {
  const [supabase] = useState(() => createClient());
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const channelName = containerId ? `container-${containerId}` : 'containers-global';
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'containers',
          ...(containerId ? { filter: `id=eq.${containerId}` } : {}),
        },
        () => onUpdate()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pallets',
          ...(containerId ? { filter: `container_id=eq.${containerId}` } : {}),
        },
        () => onUpdate()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pallet_entries',
          ...(containerId ? { filter: `container_id=eq.${containerId}` } : {}),
        },
        () => onUpdate()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expected_items',
          ...(containerId ? { filter: `container_id=eq.${containerId}` } : {}),
        },
        () => onUpdate()
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, onUpdate, containerId]);

  return { isConnected };
}
