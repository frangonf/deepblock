import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPlan, addBlock, getPlanReview, updateBlock, deleteBlock, replanBatch, getDesktopDistributionStatus, downloadBundle, nativeImportPreview, previewImport } from './api';

const native = vi.hoisted(() => ({ enabled: false }));
// Mock the environment and window
vi.mock('@/lib/runtime', () => ({
  isTauriRuntime: () => native.enabled,
  invokeTauriCommand: vi.fn(async () => { throw new Error('Not a Tauri runtime'); }),
  resolveBrowserApiBaseUrl: async () => 'http://localhost:3000',
}));

vi.mock('@/lib/dataset', () => ({ensureDataset: async () => 'test-generation', assertDataset: () => {}, retireDataset: () => {}, checkDataset: async () => {}}));

describe('api', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    native.enabled = false;
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('uses backend ActivityWatch availability in browser mode', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ enabled: true, url: 'http://127.0.0.1:5601', available: true }) });
    const status = await getDesktopDistributionStatus();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/activitywatch/status', expect.any(Object));
    expect(status.supported).toBe(false);
    expect(status.activitywatch).toMatchObject({ enabled: true, server_reachable: true, configured_port: 5601 });
  });

  it('native import cancellation and export use the dialog bridge without frontend filesystem paths', async () => {
    native.enabled = true;
    const runtime = await import('@/lib/runtime');
    vi.mocked(runtime.invokeTauriCommand).mockResolvedValueOnce(null);
    expect(await nativeImportPreview()).toBeNull();
    expect(runtime.invokeTauriCommand).toHaveBeenCalledWith('desktop_import_preview');
    vi.mocked(runtime.invokeTauriCommand).mockResolvedValueOnce(false);
    expect(await downloadBundle(true)).toBe(false);
    expect(runtime.invokeTauriCommand).toHaveBeenCalledWith('desktop_export_bundle', {recovery:true});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('browser import transports the original file without parsing arbitrary numeric metadata', async () => {
    const file = new File(['{"metadata":{"large":9007199254740993}}'], 'legacy.json');
    await previewImport(file);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/storage/import/preview', expect.objectContaining({body:file}));
  });

  describe('apiFetch', () => {
    it('does not send Content-Type for GET requests without body', async () => {
      await getPlan();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/plan/today',
        expect.objectContaining({
          headers: expect.not.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('sends Content-Type for POST requests with body', async () => {
      await addBlock({
        label: 'test',
        start: '2026-10-01T10:00:00Z',
        duration: 30,
        type: 'focus'
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/blocks',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          method: 'POST',
        })
      );
    });

    it('getPlanReview fetches without date parameter', async () => {
      await getPlanReview();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/plan/review',
        expect.any(Object)
      );
    });

    it('getPlanReview passes the requested date', async () => {
      await getPlanReview('2026-01-02');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/plan/review?date=2026-01-02',
        expect.any(Object)
      );
    });

    it('addBlock passes the target date', async () => {
      await addBlock({
        label: 'test',
        start: '10:00',
        duration: 30,
        type: 'focus'
      }, '2026-01-03');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/blocks?date=2026-01-03',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('updateBlock passes the target date', async () => {
      await updateBlock('abc123', { label: 'renamed' }, '2026-01-03');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/blocks/abc123?date=2026-01-03',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('deleteBlock passes the target date', async () => {
      await deleteBlock('abc123', '2026-01-03');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/blocks/abc123?date=2026-01-03',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('replanBatch posts all operations in a single request', async () => {
      await replanBatch({
        reason: 'Replanned from A',
        copy_mode: 'all',
        operations: [
          { op: 'create', block_id: 'draft-1', label: 'Fresh', start: '10:00', duration: 45, type: 'focus' },
          { op: 'update', block_id: 'draft-1', label: 'Renamed' },
          { op: 'delete', block_id: 'real9' },
        ],
      }, '2026-01-03');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:3000/plan/replan?date=2026-01-03');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.operations).toHaveLength(3);
      expect(body.operations[1]).toEqual({ op: 'update', block_id: 'draft-1', label: 'Renamed' });
    });
  });
});
