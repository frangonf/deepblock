import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(process.env.DEEPBLOCK_SOURCE_DIR || path.resolve(import.meta.dirname, '../../../..'));
const cwd = path.join(repoRoot, 'apps/desktop/ui');
const shouldRunNativeRuntime = process.platform === 'linux' || process.env.DEEPBLOCK_NATIVE_TAURI_E2E === '1';

function run(command: string, args: string[], timeout = 15 * 60_000) {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
    timeout,
    killSignal: 'SIGKILL',
  });

  if (result.error) throw result.error;
  if (result.status === null) throw new Error(`${command} terminated by ${result.signal ?? 'an unknown signal'}`);
  if (result.status !== 0) process.exit(result.status);
}

if (!shouldRunNativeRuntime) {
  run('pnpm', ['run', 'test:e2e']);
  process.exit(0);
}

if (process.env.DEEPBLOCK_TAURI_E2E_APP) {
  const app = path.resolve(process.env.DEEPBLOCK_TAURI_E2E_APP);
  if (!statSync(app).isFile()) throw new Error(`Native test application is not a file: ${app}`);
  accessSync(app, constants.X_OK);
  console.log(`Native compatibility: using prebuilt application ${app}`);
} else {
  run('pnpm', ['run', 'build:tauri:e2e']);
}

// Execute this reviewed test checkout, but use the selected source's dependencies.
const runtimeTest = fileURLToPath(new URL('../e2e-tauri/runtime.test.ts', import.meta.url));
const command: [string, string[]] =
  process.platform === 'linux'
    ? ['dbus-run-session', ['--', 'xvfb-run', '-a', 'node', '--test', runtimeTest]]
    : ['node', ['--test', runtimeTest]];

run(command[0], command[1], 4 * 60_000);
