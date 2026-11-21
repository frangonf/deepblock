import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as native from '../../apps/desktop/ui/scripts/tauri-e2e-core.ts';
import { containsBodyText } from '../../apps/desktop/ui/scripts/tauri-e2e-core.ts';

test('native body assertions accept CSS-transformed uppercase text without accepting missing content', () => {
  assert.equal(containsBodyText('DEEPBLOCK DESKTOP\nPlanner\nAdd block', 'DeepBlock desktop'), true);
  assert.equal(containsBodyText('DEEPBLOCK DESKTOP\nPlanner', 'Desktop parity status'), false);
  assert.equal(containsBodyText(null, 'DeepBlock desktop'), false);
});

test('an explicit prebuilt binary runs reviewed native tests without another frontend or Rust build', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepblock-prebuilt-'));
  const ui = path.join(root, 'apps/desktop/ui');
  const bin = path.join(root, 'bin');
  const app = path.join(root, 'desktop');
  const trace = path.join(root, 'trace');
  mkdirSync(ui, { recursive: true });
  mkdirSync(bin);
  writeFileSync(app, '#!/bin/sh\nexit 0\n');
  chmodSync(app, 0o755);
  for (const command of ['pnpm', 'node', 'dbus-run-session']) {
    const executable = path.join(bin, command);
    writeFileSync(executable, `#!/bin/sh\nprintf '%s|%s|%s\\n' '${command}' "$PWD" "$*" >> "$TRACE"\n`);
    chmodSync(executable, 0o755);
  }
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../apps/desktop/ui/scripts/run-tauri-e2e.ts', import.meta.url))], {
      encoding: 'utf8', timeout: 5_000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TRACE: trace, DEEPBLOCK_NATIVE_TAURI_E2E: '1', DEEPBLOCK_SOURCE_DIR: root, DEEPBLOCK_TAURI_E2E_APP: app },
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(trace, 'utf8');
    assert.doesNotMatch(commands, /build:tauri:e2e|build:web/);
    assert.ok(commands.includes(`|${realpathSync(ui)}|`), `The test must run against the selected source workspace: ${commands}`);
    assert.match(commands, /--test .*e2e-tauri\/runtime.test.ts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stalled session deletion still terminates a real stubborn driver and removes its fixture', { timeout: 5_000 }, async () => {
  assert.equal(typeof native.cleanupNativeRuntime, 'function');
  const root = mkdtempSync(path.join(tmpdir(), 'deepblock-native-cleanup-'));
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    await once(child, 'message');
    const exit = once(child, 'exit');
    const started = Date.now();
    await native.cleanupNativeRuntime(() => new Promise(() => {}), child, root, 20, 20);
    assert.ok(Date.now() - started < 1_000, 'Cleanup must not wait for remote session deletion indefinitely');
    const [, signal] = await exit;
    assert.equal(signal, 'SIGKILL');
    assert.equal(existsSync(root), false);
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});
