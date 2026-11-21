import { expect, test } from './fixtures';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { developmentConfig } from '../../../../scripts/dev-config.ts';

const root = path.resolve(import.meta.dirname, '../../../..');
const config = developmentConfig({ ...process.env, DEEPBLOCK_DEV_PORT: '5193', DEEPBLOCK_SERVER_PORT: '8031' });
let supervisor: ChildProcess;
let fixture: string;
let logs = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = mkdtempSync(path.join(tmpdir(), 'deepblock-lan-'));
  supervisor = spawn('node', ['scripts/dev.ts'], { cwd: root, env: {
    ...config.env, XDG_DATA_HOME: path.join(fixture, 'data'), XDG_CONFIG_HOME: path.join(fixture, 'config'), XDG_STATE_HOME: path.join(fixture, 'state'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  supervisor.stdout?.on('data', (chunk: Buffer) => { logs += chunk.toString(); });
  supervisor.stderr?.on('data', (chunk: Buffer) => { logs += chunk.toString(); });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (supervisor.exitCode !== null) throw new Error(`Development supervisor exited: ${logs}`);
    try { if ((await fetch(`${config.url}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* wait for services */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Development services did not start: ${logs}`);
});

test.afterAll(async () => {
  if (supervisor && supervisor.exitCode === null) {
    supervisor.kill('SIGTERM');
    try { await once(supervisor, 'exit', { signal: AbortSignal.timeout(10_000) }); }
    finally { if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL'); }
  }
  if (fixture) rmSync(fixture, { recursive: true, force: true });
  await expect(async () => {
    const response = await fetch(`${config.proxyTarget}/health`, { signal: AbortSignal.timeout(500) }).catch(() => undefined);
    expect(response).toBeUndefined();
    const frontend = await fetch(`${config.url}/api/health`, { signal: AbortSignal.timeout(500) }).catch(() => undefined);
    expect(frontend).toBeUndefined();
  }).toPass({ timeout: 5000 });
});

test('private-interface development supports same-origin writes, event sockets and Vite HMR', async ({ page, request }) => {
  let hmrConnected = false;
  page.on('console', (message) => { if (message.text().includes('[vite] connected')) hmrConnected = true; });
  const appSocket = page.waitForEvent('websocket', { predicate: (socket) => socket.url().endsWith('/api/ws/events') });
  await page.goto(config.url);
  expect((await appSocket).url()).toBe(`${config.url.replace(/^http/, 'ws')}/api/ws/events`);
  await expect.poll(() => hmrConnected).toBe(true);
  const health = await page.evaluate(async () => {
    const response = await fetch('/api/health');
    return { status: response.status, contentType: response.headers.get('content-type') };
  });
  expect(health.status).toBe(200);
  expect(health.contentType).toContain('application/json');
  const event = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`ws://${location.host}/api/ws/events`);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('No mode event through proxy')); }, 5000);
    socket.onerror = () => { clearTimeout(timeout); socket.close(); reject(new Error('WebSocket proxy failed')); };
    socket.onmessage = (message) => { if (String(message.data).includes('mode_changed')) { clearTimeout(timeout); socket.close(); resolve(String(message.data)); } };
    socket.onopen = () => { void fetch('/api/storage/status').then((response) => response.json()).then((status: {generation: string}) => fetch('/api/mode', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-deepblock-dataset-generation': status.generation }, body: JSON.stringify({ mode: 'reflect' }) })).then((response) => {
      if (!response.ok) { clearTimeout(timeout); socket.close(); reject(new Error(`Write failed: ${response.status}`)); }
    }).catch(reject); };
  }));
  expect(JSON.parse(event)).toMatchObject({ event: 'mode_changed', mode: 'reflect' });
  const foreign = await request.post(`${config.url}/api/mode`, { headers: { Origin: 'https://evil.example' }, data: { mode: 'focus' } });
  expect(foreign.status()).toBe(403);

  // Exercise the actual block-creation UI, not only API writes. Private HTTP
  // origins lack randomUUID, unlike the secure loopback fallback used in CI.
  await page.goto(`${config.url}/planner?date=2042-08-01`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.url).hostname)) {
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  }
  const label = `LAN draft ${Date.now()}`;
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill(label);
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('planner-commit-replan')).toBeEnabled();
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const saved = await (await request.get(`${config.url}/api/plan/2042-08-01`)).json();
  expect(saved.revisions.at(-1).blocks.some((block: { label: string }) => block.label === label)).toBe(true);
});
