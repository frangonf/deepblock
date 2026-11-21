import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { developmentConfig } from './dev-config.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const ui = fileURLToPath(new URL('../apps/desktop/ui/', import.meta.url));
const mode = process.argv[2] ?? 'all';
if (!['all', 'server', 'web', 'preview'].includes(mode)) throw new Error('Usage: node scripts/dev.ts [all|server|web|preview]');
const config = developmentConfig(mode === 'preview' ? { ...process.env, DEEPBLOCK_DEV_LOCAL: process.env.DEEPBLOCK_DEV_LOCAL ?? '1', DEEPBLOCK_DEV_PORT: process.env.DEEPBLOCK_DEV_PORT ?? '4173' } : process.env);
const children: ChildProcess[] = [];
let stopping = false;

function signal(child: ChildProcess, name: NodeJS.Signals) {
  if (!child.pid) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error(error); }
}
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) signal(child, 'SIGTERM');
  for (let attempt = 0; attempt < 50 && children.some((child) => child.exitCode === null && child.signalCode === null); attempt++) await delay(100);
  for (const child of children) signal(child, 'SIGKILL');
  process.exitCode = code;
}
for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => { void stop(0); });
function launch(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, env: config.env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.push(child);
  child.once('error', (error) => { console.error(error.message); void stop(1); });
  child.once('exit', (code) => { if (!stopping) void stop(code ?? 1); });
  return child;
}
async function available(host: string, port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`${host}:${port} is occupied; stop its owner or choose another port. Existing storage ownership is never bypassed.`)));
    server.listen(port, host, () => server.close((error) => error ? reject(error) : resolve()));
  });
}
try {
  console.log(`DeepBlock development: ${config.url}\nBackend: ${config.proxyTarget} (loopback only)`);
  if (config.host !== '127.0.0.1' && config.host !== '::1') console.warn('Trusted-network development only: reachable clients can read/change your data. Restrict access with a firewall/VPN.');
  if (mode !== 'server') await available(config.host, config.frontendPort);
  if (mode === 'all' || mode === 'server') {
    await available('127.0.0.1', config.backendPort);
    const server = launch('cargo', ['run', '--locked', '-p', 'deepblock-server'], root);
    if (mode === 'all') {
      let ready = false;
      for (let attempt = 0; attempt < 600 && !stopping; attempt++) {
        if (server.exitCode !== null) break;
        try {
          const response = await fetch(`${config.proxyTarget}/health`, { signal: AbortSignal.timeout(500) });
          if (response.ok && response.headers.get('content-type')?.includes('application/json')) { ready = true; break; }
        } catch { /* wait for Cargo and the backend */ }
        await delay(300);
      }
      if (!ready && !stopping) throw new Error('Backend did not start. Check ports and the storage writer lock.');
    }
  }
  if (mode !== 'server' && !stopping) launch(process.execPath, [fileURLToPath(new URL('../apps/desktop/ui/node_modules/vite/bin/vite.js', import.meta.url)), ...(mode === 'preview' ? ['preview'] : []), '--host', config.host, '--port', String(config.frontendPort), '--strictPort'], ui);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await stop(1);
}
