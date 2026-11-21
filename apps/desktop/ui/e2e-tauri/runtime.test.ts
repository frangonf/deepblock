import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

import WebDriver from 'webdriver';
import { cleanupNativeRuntime, containsBodyText } from '../scripts/tauri-e2e-core.ts';

const repoRoot = path.resolve(process.env.DEEPBLOCK_SOURCE_DIR || path.resolve(import.meta.dirname, '../../../..'));
const uiRoot = path.join(repoRoot, 'apps/desktop/ui');
const appPath = process.env.DEEPBLOCK_TAURI_E2E_APP ? path.resolve(process.env.DEEPBLOCK_TAURI_E2E_APP) : (() => {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { cwd: repoRoot, encoding: 'utf8' }));
  return path.resolve(metadata.target_directory, ...(process.env.CARGO_BUILD_TARGET ? [process.env.CARGO_BUILD_TARGET] : []), 'debug', 'deepblock-desktop');
})();
const tauriDriverPort = 4550;
const nativeDriverPort = 4551;

let tauriDriverProcess: ChildProcess | undefined;
let client: Awaited<ReturnType<typeof WebDriver.newSession>>;
let fixtureRoot: string | undefined;

function nativeDriverPath() {
  if (process.env.DEEPBLOCK_NATIVE_DRIVER) {
    return process.env.DEEPBLOCK_NATIVE_DRIVER;
  }

  if (process.platform === 'darwin') {
    return path.resolve(uiRoot, 'scripts', 'safaridriver-shim.sh');
  }

  if (process.platform === 'linux') {
    return '/usr/bin/WebKitWebDriver';
  }

  return null;
}

function waitForPort(port: number, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for port ${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

async function waitForBodyText(fragment: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastText: unknown;
  while (Date.now() < deadline) {
    const text = await client.executeScript('return document.body.innerText;', []);
    lastText = text;
    if (containsBodyText(text, fragment)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for body text: ${fragment}. Last body: ${String(lastText).slice(0, 1000)}`);
}

function elementId(element: Record<string, string>) {
  return element['element-6066-11e4-a52e-4f735466cecf'];
}

test.before(async () => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'deepblock-tauri-e2e-'));

  const sharedEnv = {
    ...process.env,
    XDG_DATA_HOME: path.join(fixtureRoot, 'data'),
    XDG_CONFIG_HOME: path.join(fixtureRoot, 'config'),
    XDG_STATE_HOME: path.join(fixtureRoot, 'state'),
  };

  const tauriDriverArgs = [
    '--port',
    `${tauriDriverPort}`,
    '--native-port',
    `${nativeDriverPort}`,
  ];

  const driverPath = nativeDriverPath();
  if (driverPath) {
    tauriDriverArgs.push('--native-driver', driverPath);
  }

  tauriDriverProcess = spawn(
    'pnpm',
    ['exec', 'tauri-driver', ...tauriDriverArgs],
    {
      cwd: uiRoot,
      env: sharedEnv,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
    },
  );
  await waitForPort(tauriDriverPort, 60_000);

  const capabilities: WebdriverIO.Capabilities & { 'tauri:options': { application: string } } = {
    'tauri:options': { application: appPath },
  };
  client = await WebDriver.newSession({
    hostname: '127.0.0.1',
    port: tauriDriverPort,
    path: '/',
    capabilities,
    connectionRetryTimeout: 10_000,
    connectionRetryCount: 0,
    logLevel: 'error',
  });
}, { timeout: 75_000 });

test.after(async () => {
  await cleanupNativeRuntime(client ? () => client.deleteSession() : undefined, tauriDriverProcess, fixtureRoot);
}, { timeout: 10_000 });

test('desktop runtime loads the planner and help routes in Tauri', { timeout: 90_000 }, async () => {
  await waitForBodyText('DeepBlock', 60_000);
  await waitForBodyText('Planner', 60_000);

  const helpLink = await client.findElement('xpath', "//a[normalize-space()='Help']");
  await client.elementClick(elementId(helpLink));

  // Shared with the original release's Help page: reviewed tooling must also
  // remain usable when validating an immutable older product tag.
  const helpText = await waitForBodyText('Keyboard navigation', 30_000);
  assert.match(helpText, /revision/i);

  const plannerLink = await client.findElement('xpath', "//a[normalize-space()='Planner']");
  await client.elementClick(elementId(plannerLink));
  const plannerText = await waitForBodyText('Add block', 30_000);
  assert.match(plannerText, /DeepBlock/i);
});
