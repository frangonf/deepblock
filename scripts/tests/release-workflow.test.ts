import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');

function job(name: string, source = workflow) {
  const contents = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[1];
  assert.ok(contents, `Missing workflow job: ${name}`);
  return contents;
}

// Check workflow policy here. Helper tests and hosted runs verify behavior.
test('release builds do not restore cached compiler state or tool binaries', () => {
  // APT verifies downloaded archives. Keep opaque build/tool caches out of QA candidates.
  for (const name of ['quality', 'macos', 'debian']) {
    const build = job(name);
    assert.match(build, /cache: false/);
    assert.doesNotMatch(build, /uses: Swatinem\/rust-cache@/);
  }
});

test('PR CI stays enabled and filters only the expensive jobs', () => {
  assert.match(ci, /^ {2}pull_request: \{\}/m);
  for (const name of ['rust-lint', 'rust-test', 'desktop-ui']) {
    assert.match(job(name, ci), /if: needs\.actions\.outputs\.lightweight-only != 'true'/);
  }
});

test('Debian packages are available even if the subsequent native test fails', () => {
  const debian = job('debian');
  const upload = debian.indexOf('name: packages-x86_64-unknown-linux-gnu');
  const native = debian.indexOf('DEEPBLOCK_TAURI_E2E_APP:');
  assert.ok(upload >= 0 && native > upload, 'Upload diagnostic packages before testing the native app');
});

test('QA packaging is manual and uses no publishing or signing credentials', () => {
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\s*\npermissions: \{\}/m);
  assert.doesNotMatch(workflow, /:\s+write\b|\bsecrets\.|\bgh release\b/);
  assert.match(job('macos'), /APPLE_SIGNING_IDENTITY: ['"]-['"]/);
});

test('the downloadable QA candidate is gated on platform builds and installation checks', () => {
  assert.match(job('debian'), /^ {4}needs: macos$/m);
  assert.match(job('debian-install'), /^ {4}needs: debian$/m);
  const assemble = job('assemble');
  assert.match(assemble, /needs: \[macos, debian-install\]/);
  assert.match(assemble, /name: release-candidate/);
});

test('all QA stages check out the dispatched commit', () => {
  for (const name of ['quality', 'macos', 'debian', 'debian-install', 'assemble']) {
    assert.deepEqual([...job(name).matchAll(/^ {10}ref: (.+)$/gm)].map((match) => match[1]), ['${{ github.sha }}']);
  }
});
