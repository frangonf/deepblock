import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

const smoke = readFileSync(fileURLToPath(new URL('../debian-smoke.sh', import.meta.url)), 'utf8');

test('packaged desktop survival has a forced-kill deadline without accepting an early killed process', () => {
  assert.match(smoke, /timeout --signal=TERM --kill-after=2s 15s deepblock-desktop/);
  assert.match(smoke, /desktop_started=\$SECONDS/);
  assert.match(smoke, /status.*-eq 124.*status.*-eq 137/);
  assert.match(smoke, /SECONDS - desktop_started.*-ge 15/);
});

test('desktop exit classification rejects early kills and normal/crash exits', () => {
  const check = smoke.split('\n').find((line) => line.startsWith('[[ ( "$status"'));
  assert.ok(check);
  for (const [status, runtime, accepted] of [
    [124, 15, true], [137, 17, true], [137, 1, false],
    [124, 1, false], [0, 16, false], [139, 16, false],
  ] as const) {
    // Execute the actual shell assertion, not a reimplementation of its logic.
    const result: SpawnSyncReturns<string> = spawnSync('bash', ['-c', `status=$1; SECONDS=100; desktop_started=$((100 - $2)); ${check}`, '_', String(status), String(runtime)], { encoding: 'utf8' });
    assert.equal(result.status === 0, accepted, `status=${status} runtime=${runtime}: ${result.stderr}`);
  }
});

test('clean-system smoke pre-creates every XDG directory level with user ownership', () => {
  // `install -d -o user -g group` applies ownership only to the final listed
  // directories; intermediate parents would stay root-owned. The packaged
  // server creates data subdirectories under XDG_DATA_HOME/deepblock as an
  // unprivileged user, so each parent must receive ownership explicitly or
  // startup fails with EACCES.
  const lines = smoke.split('\n');
  const statement: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (statement.length === 0) {
      if (trimmed.startsWith('install -d')) statement.push(trimmed);
    } else if (statement.at(-1)?.endsWith('\\')) {
      statement.push(trimmed);
    } else {
      break;
    }
  }
  assert.ok(statement.length > 0, 'smoke script must create XDG directories');
  const installArgs = statement.join(' ');
  assert.match(installArgs, /-o smoke -g smoke/);
  for (const dir of [
    '"$XDG_DATA_HOME"',
    '"$XDG_DATA_HOME/deepblock"',
    '"$XDG_DATA_HOME/deepblock/notes"',
    '"$XDG_CONFIG_HOME"',
    '"$XDG_CONFIG_HOME/deepblock"',
    '"$XDG_STATE_HOME"',
    '"$XDG_STATE_HOME/deepblock"',
  ]) {
    assert.ok(
      installArgs.includes(dir),
      `${dir} must be an explicit install -d argument so it receives smoke ownership`,
    );
  }
});
