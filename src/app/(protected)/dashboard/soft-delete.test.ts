// @vitest-environment jsdom
import { createClient } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { expect, it, vi } from 'vitest';
import DashboardPage from './page';

const { createBrowserSupabaseClient } = vi.hoisted(() => ({
  createBrowserSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient }));
vi.mock('@/context/AuthPermissionContext', () => ({
  useAuth: () => ({ isMaster: true, hasPermission: () => false }),
}));
vi.mock('@/lib/utils/audio-feedback', () => ({
  playScanBeep: vi.fn(),
  playVerifyChime: vi.fn(),
  playErrorBuzzer: vi.fn(),
}));

it('removes a soft-deleted container and its empty consignment from Waiting', async () => {
  const createdAt = '2026-10-20T09:00:00Z';
  const containers = [
    {
      id: 'first',
      container_number: 'UNIT-A',
      consignment_id: 'delivery-a',
      status: 'active',
      created_at: createdAt,
      deleted_at: null as string | null,
    },
    { id: 'second', container_number: 'UNIT-B', status: 'completed', created_at: createdAt, deleted_at: null },
  ];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    switch (url.pathname) {
      case '/rest/v1/rpc/soft_delete_container': {
        const { p_container_id } = JSON.parse(String(init?.body));
        const container = containers.find((row) => row.id === p_container_id);
        if (!container || container.deleted_at) {
          return Response.json({ message: 'Container not found or already deleted' }, { status: 400 });
        }
        container.deleted_at = '2026-10-20T10:00:00Z';
        return Response.json(container);
      }
      case '/rest/v1/containers': {
        const visible = url.searchParams.get('deleted_at') === 'is.null'
          ? containers.filter((row) => row.deleted_at === null)
          : containers;
        return Response.json(visible);
      }
      case '/rest/v1/consignments':
        return Response.json([{ id: 'delivery-a', consignment_ref: 'PO-1001', status: 'active' }]);
      default:
        return Response.json([]);
    }
  });
  const supabase = createClient('http://127.0.0.1:54321', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  createBrowserSupabaseClient.mockReturnValue({
    from: supabase.from.bind(supabase),
    rpc: supabase.rpc.bind(supabase),
    channel: () => channel,
    removeChannel: vi.fn(),
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { unmount } = render(createElement(DashboardPage));

  try {
    expect(await screen.findByRole('button', { name: 'Waiting 1' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'PO-1001' }).getAttribute('href')).toBe('/workbench/first');
    fireEvent.click(screen.getByRole('button', { name: 'Waiting 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(containers[0].deleted_at).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Waiting 0' })).toBeTruthy();
    });
    expect(screen.queryByRole('link', { name: 'PO-1001' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done 1' }));
    expect(screen.getByRole('link', { name: 'UNIT-B' })).toBeTruthy();
  } finally {
    unmount();
    confirm.mockRestore();
  }
});
