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

function assertLocalAptAfterCheckout(contents: string, profiles: string[]) {
  const steps = [...contents.matchAll(/^ {8}uses: (\S*setup-apt\S*)[^\n]*\n {8}with:\n {10}profile: (\w+)$/gm)];
  assert.deepEqual(steps.map((step) => [step[1], step[2]]), profiles.map((profile) => ['$/.github/actions/setup-apt', profile]));
  const checkout = contents.indexOf('uses: actions/checkout@');
  assert.ok(checkout >= 0 && checkout < steps[0].index, 'The APT scripts require an earlier checkout');
}

test('release quality uses local APT setup and separates browser dependencies from downloads', () => {
  const quality = job('quality');
  assertLocalAptAfterCheckout(quality, ['desktop', 'chromium']);
  assert.doesNotMatch(quality, /playwright install --with-deps/);
  assert.match(quality, /timeout-minutes: 5\n\s+run: pnpm -C apps\/desktop\/ui exec playwright install chromium/);
});

test('release builds do not restore cached compiler state or tool binaries', () => {
  // APT verifies downloaded archives. Keep opaque build/tool caches out of QA candidates.
  for (const name of ['quality', 'macos', 'debian']) {
    const build = job(name);
    assert.match(build, /cache: false/);
    assert.doesNotMatch(build, /uses: Swatinem\/rust-cache@/);
  }
});

test('routine CI shares local desktop and browser dependency setup', () => {
  assertLocalAptAfterCheckout(job('rust-lint', ci), ['desktop']);
  assertLocalAptAfterCheckout(job('rust-test', ci), ['desktop']);
  assertLocalAptAfterCheckout(job('desktop-ui', ci), ['chromium']);
  assert.doesNotMatch(ci, /playwright install --with-deps/);
});

test('lightweight PRs still report the required checks, with expensive jobs skipped', () => {
  assert.match(ci, /^ {2}workflow_dispatch:$/m);
  assert.match(ci, /^ {2}push:\n {4}branches: \[main\]\n {4}paths-ignore:\n {6}- "docs\/\*\*"\n {6}- "README\.md"\n {6}- "AGENTS\.md"\n {6}- "\.gitignore"\n {2}pull_request:\n\npermissions:/m);
  const lint = job('actions', ci);
  assert.match(lint, /fetch-depth: .*github\.event_name == 'pull_request' && '2'/);
  assert.match(lint, /lightweight-only: \$\{\{ steps\.paths\.outputs\.lightweight-only \}\}/);
  assert.match(lint, /if: github\.event_name == 'pull_request'\n {8}run: bash scripts\/pr-paths\.sh/);
  for (const name of ['rust-lint', 'rust-test', 'desktop-ui']) {
    assert.match(job(name, ci), /^ {4}needs: actions\n {4}if: needs\.actions\.outputs\.lightweight-only != 'true'$/m);
  }
});

test('Debian setup and clean installation tests use bounded APT from the checked-out source', () => {
  assertLocalAptAfterCheckout(job('debian'), ['debian']);
  assert.match(job('debian'), /Acquire::http::Timeout=30/);
  assert.match(job('debian-install'), /bash \/ci-apt\.sh configure/);
  assert.match(job('debian-install'), /source=\$PWD\/scripts\/debian-smoke\.sh,target=\/smoke.sh,readonly/);
});

// Static guards for the workflow's resource/safety contract; actionlint validates
// YAML and expressions, while dispatched candidates validate runner behavior.
test('macOS failure prevents Debian builds and installation failures cancel siblings', () => {
  assert.match(job('debian'), /^ {4}needs: macos$/m);
  assert.match(job('debian-install'), /fail-fast: true/);
});

test('Debian retains packages and tests the release binary without cleaning or rebuilding it', () => {
  const debian = job('debian');
  const packages = debian.indexOf('mise run release:collect');
  const upload = debian.indexOf('name: packages-x86_64-unknown-linux-gnu');
  const native = debian.indexOf('- name: Native WebKit UI compatibility');
  assert.ok(packages >= 0 && upload > packages && native > upload, 'Collected packages must survive a later native-test failure');
  assert.doesNotMatch(debian, /cargo clean|mbx clean|clean:mbx|CARGO_PROFILE_DEV_DEBUG/);
  assert.match(debian, /DEEPBLOCK_TAURI_E2E_APP: .*\/target\/x86_64-unknown-linux-gnu\/release\/deepblock-desktop/);
  assert.match(debian, /name: Native WebKit UI compatibility\n\s+timeout-minutes: 5/);
  assert.match(debian, /node apps\/desktop\/ui\/scripts\/run-tauri-e2e\.ts/);
  assert.match(debian, /CARGO_INCREMENTAL: '0'/);
});

test('QA packaging is manual and uses no publishing or signing credentials', () => {
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\s*\npermissions: \{\}/m);
  assert.doesNotMatch(workflow, /:\s+write\b|\bsecrets\.|\bgh release\b|upload-draft\.sh/);
  assert.match(job('macos'), /APPLE_SIGNING_IDENTITY: ['"]-['"]/);
});

test('the downloadable QA candidate is gated on packaging checks and includes checksums', () => {
  const assemble = job('assemble');
  assert.match(assemble, /needs: \[macos, debian-install\]/);
  assert.match(assemble, /run: node scripts\/release\.ts assets/);
  assert.match(assemble, /name: release-candidate\n\s+path: dist\/release\/\*/);
  assert.match(assemble, /retention-days: 30/);
});

test('all QA stages check out the dispatched commit', () => {
  for (const name of ['quality', 'macos', 'debian', 'debian-install', 'assemble']) {
    assert.deepEqual([...job(name).matchAll(/^ {10}ref: (.+)$/gm)].map((match) => match[1]), ['${{ github.sha }}']);
  }
  for (const platform of ['macos', 'debian']) {
    assert.match(job(platform), /node scripts\/build\.ts bundle/);
  }
});
