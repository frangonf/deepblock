import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../ci-apt.sh', import.meta.url));

test('APT cache identity includes all installer definitions and the source lockfile', () => {
  const action = readFileSync(new URL('../../.github/actions/setup-apt/action.yml', import.meta.url), 'utf8');
  assert.match(action, /sha256sum "\$script" "\$GITHUB_ACTION_PATH\/action.yml" "\$GITHUB_WORKSPACE\/scripts\/bootstrap-debian.sh"/);
  assert.match(action, /hashFiles\('pnpm-lock.yaml'\)/);
  assert.match(action, /github.ref == 'refs\/heads\/main' && github.event_name != 'pull_request'/);
});

test('APT profiles reject unsupported inputs before invoking a package manager', () => {
  const result = spawnSync('bash', [script, 'install', '--allow-unauthenticated', '/unused'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown APT profile/);
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'deepblock-apt-'));
  mkdirSync(path.join(root, 'etc/apt/apt.conf.d'), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('CI APT configuration retries stalled transfers and retains downloaded packages', () => {
  const { root, cleanup } = fixture();
  try {
    writeFileSync(path.join(root, 'etc/apt/apt.conf.d/docker-clean'), 'DPkg::Post-Invoke { "rm -f /var/cache/apt/archives/*.deb"; };');
    const result = spawnSync('bash', [script, 'configure', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const config = readFileSync(path.join(root, 'etc/apt/apt.conf.d/99deepblock-ci'), 'utf8');
    assert.match(config, /Acquire::Retries "3"/);
    assert.match(config, /Acquire::http::Timeout "30"/);
    assert.match(config, /Acquire::https::Timeout "30"/);
    assert.match(config, /APT::Update::Error-Mode "any"/);
    assert.match(config, /Keep-Downloaded-Packages "true"/);
    assert.throws(() => readFileSync(path.join(root, 'etc/apt/apt.conf.d/docker-clean')));
  } finally { cleanup(); }
});

test('GitHub Ubuntu mirror lists prefer official HTTPS Ubuntu mirrors, leaving Debian sources alone', () => {
  const { root, cleanup } = fixture();
  try {
    const sources = path.join(root, 'etc/apt/sources.list');
    writeFileSync(sources, 'deb https://deb.debian.org/debian bookworm main\n');
    let result = spawnSync('bash', [script, 'configure', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(sources, 'utf8'), 'deb https://deb.debian.org/debian bookworm main\n');
    const mirrors = path.join(root, 'etc/apt/apt-mirrors.txt');
    writeFileSync(mirrors, 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n');
    result = spawnSync('bash', [script, 'configure', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(mirrors, 'utf8'), 'https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://security.ubuntu.com/ubuntu/\tpriority:2\n');
  } finally { cleanup(); }
});
