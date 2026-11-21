import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const config = readFileSync(new URL('../../mise.toml', import.meta.url), 'utf8');

function task(name: string) {
  const header = name.includes(':') ? `[tasks."${name}"]` : `[tasks.${name}]`;
  const section = config.split(header + '\n')[1]?.split('\n[tasks.')[0];
  assert.ok(section, `Missing task: ${name}`);
  const run = section.match(/run = """\n([\s\S]*?)"""/)?.[1]
    ?? section.match(/run = "([^"\n]*)"/)?.[1];
  assert.ok(run, `Missing run command: ${name}`);
  const syntax = spawnSync('/bin/sh', ['-n'], { input: run, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  return run.trim();
}

test('cleanup separates project builds from shared cache trimming and preserves source files', () => {
  assert.ok(!config.includes('[tasks."clean:mbx"]'));
  const trim = task('cache:trim');
  assert.match(trim, /\$\{MBX_MAX_SIZE:-50MiB\}/);
  assert.match(trim, /mbx gc --max-size/);
  assert.doesNotMatch(trim, /cargo clean|mbx clean|rm -rf/);
  assert.equal(task('clean:rust'), 'set -eu\ncargo clean\nmbx clean');
  assert.equal(task('clean'), 'set -eu\nmise run clean:rust\nmise run clean:web\nrm -rf dist\nmise run cache:trim');

  const root = mkdtempSync(path.join(tmpdir(), 'cleanup-tasks-'));
  const outputs = ["node_modules","apps/desktop/ui/node_modules","apps/desktop/ui/dist","apps/desktop/ui/test-results","apps/desktop/ui/playwright-report","dist/release","dist/release-validation"];
  try {
    for (const output of outputs) mkdirSync(path.join(root, output), { recursive: true });
    writeFileSync(path.join(root, 'source.txt'), 'keep');
    const result = spawnSync('/bin/sh', ['-eu', '-c', `${task('clean:web')}\nrm -rf dist`], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const output of outputs) assert.equal(existsSync(path.join(root, output)), false, output);
    assert.equal(readFileSync(path.join(root, 'source.txt'), 'utf8'), 'keep');
    const repeat = spawnSync('/bin/sh', ['-eu', '-c', task('clean:web')], { cwd: root, encoding: 'utf8' });
    assert.equal(repeat.status, 0, repeat.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
