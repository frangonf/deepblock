import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNoteUnloadWarning } from '@/hooks/use-note-autosave';
import { NotesPage } from './NotesPage';

let saved: Record<string, string>;
let failWrites: boolean;
let writeGate: Promise<void> | null;
let readGate: Promise<void> | null;
let capturedReads: string[];
let writes: string[];
beforeEach(() => {
  saved = { '2099-01-02': 'Saved note' };
  failWrites = false;
  writeGate = null;
  readGate = null;
  capturedReads = [];
  writes = [];
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const date = String(url).split('/notes/')[1];
    if (date) {
      if (init?.method === 'PUT') {
        const content = JSON.parse(init.body as string).content;
        writes.push(content);
        if (writeGate) await writeGate;
        if (failWrites) return new Response('Write failed', { status: 500 });
        saved[date] = content;
      }
      const content = saved[date] ?? '';
      if (init?.method !== 'PUT' && readGate) { capturedReads.push(content); await readGate; }
      return new Response(JSON.stringify({ content }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());
function UnloadGuard() { useNoteUnloadWarning(); return null; }
function notes() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><UnloadGuard /><MemoryRouter initialEntries={['/notes?date=2099-01-02']}>
    <Link to="/away">Away</Link><Link to="/notes?date=2099-01-02">Notes</Link>
    <Routes><Route path="/notes" element={<NotesPage />} /><Route path="/away" element={<p>Other page</p>} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}
it('autosaves the latest text without a manual save action', async () => {
  notes();
  const editor = await screen.findByRole('textbox');
  await waitFor(() => expect(editor).toHaveValue('Saved note'));
  fireEvent.change(editor, { target: { value: 'New reflection' } });
  await waitFor(() => expect(saved['2099-01-02']).toBe('New reflection'), { timeout: 2000 });
  expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
});
it('does not let an older refetch replace acknowledged note text', async () => {
  const { client } = notes();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Saved note'));
  let release!: () => void;
  readGate = new Promise<void>((resolve) => { release = resolve; });
  const refreshing = client.refetchQueries({ queryKey: ['notes', '2099-01-02'] });
  await waitFor(() => expect(capturedReads).toEqual(['Saved note']));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acknowledged text' } });
  await waitFor(() => expect(saved['2099-01-02']).toBe('Acknowledged text'), { timeout: 2000 });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
  await act(async () => { readGate = null; release(); await refreshing; });
  expect(client.getQueryData(['notes', '2099-01-02'])).toEqual({ content: 'Acknowledged text' });
  expect(screen.getByRole('textbox')).toHaveValue('Acknowledged text');
});
it('retains and saves edits when navigating before the debounce finishes', async () => {
  notes();
  const editor = await screen.findByRole('textbox');
  await waitFor(() => expect(editor).toHaveValue('Saved note'));
  fireEvent.change(editor, { target: { value: 'Before navigation' } });
  fireEvent.click(screen.getByRole('link', { name: 'Away' }));
  fireEvent.click(screen.getByRole('link', { name: 'Notes' }));
  expect(await screen.findByRole('textbox')).toHaveValue('Before navigation');
  await waitFor(() => expect(saved['2099-01-02']).toBe('Before navigation'), { timeout: 2000 });
});
it('keeps failed writes recoverable and offers an explicit retry', async () => {
  failWrites = true;
  const first = notes();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Saved note'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Recoverable' } });
  expect(await screen.findByRole('button', { name: 'Retry save' })).toBeEnabled();
  expect(screen.getByRole('textbox')).toHaveValue('Recoverable');
  expect(sessionStorage.getItem('deepblock.note-draft.v2:unscoped:2099-01-02')).toBe('Recoverable');
  first.unmount();
  failWrites = false;
  notes();
  expect(await screen.findByRole('textbox')).toHaveValue('Recoverable');
  await waitFor(() => expect(saved['2099-01-02']).toBe('Recoverable'), { timeout: 2000 });
  expect(sessionStorage.getItem('deepblock.note-draft.v2:unscoped:2099-01-02')).toBeNull();
});
it('serializes navigation saves and never clears text edited during an older save', async () => {
  let release!: () => void;
  writeGate = new Promise<void>((resolve) => { release = resolve; });
  notes();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Saved note'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First submission' } });
  await waitFor(() => expect(writes).toEqual(['First submission']), { timeout: 2000 });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Latest submission' } });
  fireEvent.click(screen.getByRole('link', { name: 'Away' }));
  fireEvent.click(screen.getByRole('link', { name: 'Notes' }));
  expect(await screen.findByRole('textbox')).toHaveValue('Latest submission');
  expect(writes).toEqual(['First submission']);
  await act(async () => { writeGate = null; release(); });
  await waitFor(() => expect(saved['2099-01-02']).toBe('Latest submission'));
  expect(screen.getByRole('textbox')).toHaveValue('Latest submission');
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
});
it('reports save status for the selected day rather than another day’s request', async () => {
  let release!: () => void;
  writeGate = new Promise<void>((resolve) => { release = resolve; });
  notes();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Saved note'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First day saving' } });
  await waitFor(() => expect(writes).toEqual(['First day saving']), { timeout: 2000 });
  fireEvent.change(screen.getByLabelText('Plan date'), { target: { value: '2099-01-03' } });
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  await act(async () => { writeGate = null; release(); });
});
it('warns on unload while an unmounted note still awaits acknowledgement', async () => {
  let release!: () => void;
  writeGate = new Promise<void>((resolve) => { release = resolve; });
  notes();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Saved note'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pending after navigation' } });
  fireEvent.click(screen.getByRole('link', { name: 'Away' }));
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await act(async () => { writeGate = null; release(); });
  await waitFor(() => expect(sessionStorage.getItem('deepblock.note-draft.v2:unscoped:2099-01-02')).toBeNull());
  const savedUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(savedUnload);
  expect(savedUnload.defaultPrevented).toBe(false);
});
it('saves separate dates without crossing their contents', async () => {
  notes();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Saved note'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First day' } });
  fireEvent.change(screen.getByLabelText('Plan date'), { target: { value: '2099-01-03' } });
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second day' } });
  await waitFor(() => expect(saved['2099-01-03']).toBe('Second day'), { timeout: 2000 });
  expect(saved['2099-01-02']).toBe('First day');
});
