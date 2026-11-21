import { expect, test, vi } from 'vitest';
import { getWsUrl } from './api';

vi.mock('@/lib/runtime', () => ({
  isTauriRuntime: () => false,
  resolveBrowserApiBaseUrl: async () => '/api',
  invokeTauriCommand: vi.fn(),
}));

test('same-origin proxy creates a valid browser WebSocket URL', async () => {
  const url = await getWsUrl();
  expect(url).toBe(`ws://${window.location.host}/api/ws/events`);
  expect(new URL(url).protocol).toBe('ws:');
});
