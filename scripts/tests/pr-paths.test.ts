import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../pr-paths.sh', import.meta.url));

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'deepblock-pr-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  const commit = () => {
    git('add', '--all');
    git('-c', 'user.name=Tester', '-c', 'user.email=tests@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
  };
  git('init', '-q');
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'app.ts'), 'export const app = 1;\n');
  writeFileSync(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  commit();
  const output = path.join(root, 'output');
  const run = () => spawnSync('bash', [script], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
  return { root, git, commit, run, output };
}

test('only docs and root README/AGENTS changes skip the expensive checks', (t) => {
  const { root, commit, run, output } = fixture(t);
  mkdirSync(path.join(root, 'docs', 'nested'));
  writeFileSync(path.join(root, 'docs', 'nested', 'guide.md'), '# Nested\n');
  writeFileSync(path.join(root, 'README.md'), '# DeepBlock\n');
  writeFileSync(path.join(root, 'AGENTS.md'), '# Agents\n');
  commit();

  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'docs-only=true\n');
});

test('mixed changes, including moving a source file into docs, still run the checks', (t) => {
  const { root, git, commit, run, output } = fixture(t);
  git('mv', 'app.ts', 'docs/app.ts');
  writeFileSync(path.join(root, 'docs', 'guide.md'), '# Updated guide\n');
  commit();

  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'docs-only=false\n');
});

test('a missing comparison parent fails closed', (t) => {
  const { run } = fixture(t);
  const result = run();
  assert.equal(result.status, 128, result.stderr);
});
