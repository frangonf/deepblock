import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  applyLicenseOverrides,
  evaluateLicenseExpression,
  groupByLicense,
  noticesMatch,
  parseCargoMetadata,
  parsePnpmLicenses,
  renderNotices,
} from '../licenses-core.ts';

test('permissive license expressions are allowed', () => {
  for (const expression of [
    'MIT',
    'Apache-2.0',
    'ISC',
    'MPL-2.0',
    'Unicode-3.0',
    'Unlicense',
    '0BSD',
    'CDLA-Permissive-2.0',
    'MIT OR Apache-2.0',
    'Apache-2.0 OR MIT',
    'MIT/Apache-2.0',
    'Apache-2.0/MIT',
    'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT',
    'Zlib OR Apache-2.0 OR MIT',
    'BSD-3-Clause AND MIT',
    'Apache-2.0 AND ISC',
    '(MIT OR Apache-2.0) AND Unicode-3.0',
    'ISC AND (Apache-2.0 OR ISC) AND Apache-2.0 AND MIT AND BSD-3-Clause AND (Apache-2.0 OR ISC OR MIT) AND (Apache-2.0 OR ISC OR MIT-0)',
  ]) {
    const verdict = evaluateLicenseExpression(expression);
    assert.equal(verdict.allowed, true, `${expression} should be allowed (${verdict.reason})`);
  }
});

test('copyleft, unknown, and missing licenses are rejected', () => {
  for (const expression of [
    'GPL-3.0-only',
    'AGPL-3.0',
    'LGPL-2.1-or-later',
    'SSPL-1.0',
    'BUSL-1.1',
    'MIT AND GPL-3.0-only',
    'GPL-3.0-only OR AGPL-3.0',
    'Unknown',
    'NOASSERTION',
    '',
    'Proprietary',
  ]) {
    const verdict = evaluateLicenseExpression(expression);
    assert.equal(verdict.allowed, false, `${expression} should be rejected`);
  }
});

test('an OR expression passes when any alternative is permissive', () => {
  assert.equal(evaluateLicenseExpression('GPL-3.0-only OR MIT').allowed, true);
  // r-efi style: LGPL appears only as one alternative of a permissive choice.
  assert.equal(evaluateLicenseExpression('MIT OR Apache-2.0 OR LGPL-2.1-or-later').allowed, true);
});

test('unknown exceptions and unparseable expressions are rejected', () => {
  assert.equal(evaluateLicenseExpression('Apache-2.0 WITH GPL-3.0-exception').allowed, false);
  assert.match(evaluateLicenseExpression('Apache-2.0 WITH GPL-3.0-exception').reason, /exception/);
  for (const expression of ['MIT OR', 'MIT extra-token', 'AND MIT', 'MIT)']) {
    const verdict = evaluateLicenseExpression(expression);
    assert.equal(verdict.allowed, false, `${expression} should be rejected`);
    assert.match(verdict.reason, /unparseable/);
  }
});

test('cargo metadata drops workspace members and keeps dependency versions', () => {
  const metadata = JSON.stringify({
    workspace_members: ['deepblock-server 0.2.0 (path+file:///apps/server)'],
    packages: [
      { id: 'deepblock-server 0.2.0 (path+file:///apps/server)', name: 'deepblock-server', version: '0.2.0', license: 'MIT' },
      { id: 'serde 1.0.300 (registry+https://github.com/rust-lang/crates.io-index)', name: 'serde', version: '1.0.300', license: 'MIT OR Apache-2.0' },
      { id: 'old 0.1.0 (registry+https://github.com/rust-lang/crates.io-index)', name: 'old', version: '0.1.0' },
    ],
  });
  const entries = parseCargoMetadata(metadata);
  assert.deepEqual(
    entries.map((entry) => `${entry.name}@${entry.version}=${entry.license}`),
    ['old@0.1.0=', 'serde@1.0.300=MIT OR Apache-2.0'],
  );
});

test('pnpm license groups flatten to one entry per package version', () => {
  const groups = JSON.stringify({
    MIT: [
      { name: 'preact', versions: ['10.29.8'] },
      { name: '@preact/signals', versions: ['2.11.4'] },
    ],
    Unknown: [{ name: 'mystery', versions: ['1.0.0', '1.1.0'] }],
  });
  const entries = parsePnpmLicenses(groups);
  assert.deepEqual(
    entries.map((entry) => `${entry.name}@${entry.version}=${entry.license}`),
    [
      '@preact/signals@2.11.4=MIT',
      'mystery@1.0.0=Unknown',
      'mystery@1.1.0=Unknown',
      'preact@10.29.8=MIT',
    ],
  );
});

test('verified license overrides replace missing registry metadata by pinned version', () => {
  const entries = applyLicenseOverrides([
    { name: '@schedule-x/resize', version: '3.7.3', license: 'Unknown' },
    { name: '@schedule-x/resize', version: '3.7.3', license: '  ' },
    { name: '@schedule-x/resize', version: '3.8.0', license: 'Unknown' },
    { name: 'preact', version: '10.29.8', license: 'MIT' },
  ]);
  assert.deepEqual(entries.map(({ license }) => license), ['MIT', 'MIT', 'Unknown', 'MIT']);
});

test('pinned overrides never replace explicit license metadata', () => {
  const entries = applyLicenseOverrides([
    { name: '@schedule-x/resize', version: '3.7.3', license: 'GPL-3.0-only' },
    { name: '@schedule-x/resize', version: '3.7.3', license: 'Apache-2.0' },
    { name: '@schedule-x/resize', version: '3.7.3', license: 'SEE LICENSE IN LICENSE' },
  ]);
  assert.deepEqual(entries.map(({ license }) => license), ['GPL-3.0-only', 'Apache-2.0', 'SEE LICENSE IN LICENSE']);
  assert.equal(evaluateLicenseExpression(entries[0].license).allowed, false);
});

test('notices render grouped packages with license notes only when present', () => {
  const notices = renderNotices(
    groupByLicense([
      { name: 'serde', version: '1.0.0', license: 'MIT OR Apache-2.0' },
      { name: 'option-ext', version: '0.2.0', license: 'MPL-2.0' },
    ]),
    groupByLicense([{ name: 'preact', version: '10.29.8', license: 'MIT' }]),
  );
  assert.match(notices, /# Third-party notices/);
  assert.match(notices, /### MIT OR Apache-2\.0 \(1 package\)/);
  assert.match(notices, /`option-ext@0\.2\.0`/);
  assert.match(notices, /## Desktop UI dependencies \(production\)/);
  assert.match(notices, /MPL-2\.0 is file-level copyleft/);
  assert.ok(!notices.includes('LLVM-exception'), 'unused note must not render');
});

test('notices retain their license group order across locales', () => {
  const core = new URL('../licenses-core.ts', import.meta.url).href;
  const script = `
    import { groupByLicense, renderNotices } from ${JSON.stringify(core)};
    const entries = [
      { name: 'alpha', version: '1.0.0', license: 'ISC AND MIT' },
      { name: 'beta', version: '1.0.0', license: 'isc' },
    ];
    process.stdout.write(renderNotices(groupByLicense(entries), []));
  `;
  const render = (locale: string) => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: locale },
  });
  const english = render('en_US.UTF-8');
  assert.deepEqual(english.match(/^### .+$/gm), ['### isc (1 package)', '### ISC AND MIT (1 package)']);
  assert.equal(render('tr_TR.UTF-8'), english);
});

test('notices output is deterministic and detects drift', () => {
  const entries = [
    { name: 'zeta', version: '1.0.0', license: 'MIT' },
    { name: 'alpha', version: '0.2.0', license: 'MIT' },
  ];
  const rendered = renderNotices(groupByLicense(entries), []);
  assert.equal(rendered, renderNotices(groupByLicense(entries), []));
  assert.equal(noticesMatch(rendered, rendered), true);
  assert.equal(noticesMatch(rendered.replaceAll('\n', '\r\n'), rendered), true);
  assert.equal(noticesMatch(`${rendered}\nextra`, rendered), false);
});
