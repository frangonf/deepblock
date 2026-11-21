import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkVersions, prepareVersion, validateVersion, verifyAssets, resourceDirectory, normalizeDesktopControl } from '../release-core.ts';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'deepblock-release-'));
  for (const dir of ['apps/desktop/ui', 'apps/desktop/src-tauri']) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, 'Cargo.toml'), '[workspace.package]\nversion = "0.1.0"\nedition = "2024"\n');
  writeFileSync(path.join(root, 'Cargo.lock'), '# retained\nversion = 4\n\n' + ['deepblock-server', 'deepblock-cli', 'deepblock-desktop', 'foreign'].map((name) => `[[package]]\nname = "${name}"\nversion = "0.1.0"\n`).join('\n'));
  for (const file of ['apps/desktop/ui/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) writeFileSync(path.join(root, file), JSON.stringify({ version: '0.1.0', keep: true }, null, 2) + '\n');
  writeFileSync(path.join(root, 'CHANGELOG.md'), [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Pending item.',
    '',
    '## [0.1.0] - 2026-04-17',
    '',
    'Initial snapshot.',
    '',
    '[Unreleased]: https://github.com/frangonf/deepblock/compare/v0.1.0...HEAD',
    '[0.1.0]: https://github.com/frangonf/deepblock/releases/tag/v0.1.0',
    '',
  ].join('\n'));
  return root;
}

test('release preparation updates only product versions and preserves history/dependencies', () => {
  const root = fixture();
  try {
    const preview = prepareVersion(root, '0.2.0', 'New features.', false);
    assert.equal(preview.length, 5);
    assert.equal(checkVersions(root), '0.1.0');
    prepareVersion(root, '0.2.0', 'New features.', true);
    assert.equal(checkVersions(root), '0.2.0');
    assert.match(readFileSync(path.join(root, 'Cargo.lock'), 'utf8'), /name = "foreign"\nversion = "0.1.0"/);
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[0\.2\.0\] - \d{4}-\d{2}-\d{2}\n\nNew features\.\n\n### Added\n\n- Pending item\./);
    assert.match(changelog, /[\s\S]*## \[0\.1\.0\] - 2026-04-17\n\nInitial snapshot\./);
    assert.match(changelog, /^\[Unreleased\]: .*compare\/v0\.2\.0\.\.\.HEAD$/m);
    assert.match(changelog, /^\[0\.2\.0\]: .*releases\/tag\/v0\.2\.0$/m);
    assert.match(changelog, /## \[Unreleased\]\n\n## \[0\.2\.0\]/);
    assert.throws(() => prepareVersion(root, '0.2.0', '', true), /newer/);
    assert.throws(() => prepareVersion(root, '0.1.0', '', true), /newer/);
  } finally { rmSync(root, { recursive: true }); }
});

test('SemVer is strict and prereleases are supported', () => {
  assert.equal(validateVersion('1.2.3-rc.1'), '1.2.3-rc.1');
  for (const value of ['v1.2.3', '01.2.3', '1.2', '1.2.3-01', '1.2.3+build', '1.2.3;echo bad']) assert.throws(() => validateVersion(value));
});

test('mismatched JSON versions and unexpected manifests stop preparation', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, 'apps/desktop/ui/package.json'), '{"version":"9.0.0"}');
    assert.throws(() => checkVersions(root), /mismatch/);
    assert.throws(() => prepareVersion(root, '0.2.0', '', true), /mismatch/);
    assert.match(readFileSync(path.join(root, 'Cargo.toml'), 'utf8'), /0.1.0/);
  } finally { rmSync(root, { recursive: true }); }
});

test('staging resolves explicit target triples and custom target directories', () => {
  assert.equal(resourceDirectory('/repo/build', 'aarch64-apple-darwin'), '/repo/build/aarch64-apple-darwin/release');
  assert.equal(resourceDirectory('/repo/target'), '/repo/target/release');
  assert.throws(() => resourceDirectory('/repo/target', '../../escape'));
});

test('desktop Debian identity and prerelease ordering are normalized without changing dependencies', () => {
  const control = 'Package: deep-block\nVersion: 0.2.0-rc.1\nArchitecture: amd64\nDepends: libgtk-3-0\n';
  assert.equal(normalizeDesktopControl(control, '0.2.0-rc.1'), 'Package: deepblock-desktop\nVersion: 0.2.0~rc.1\nArchitecture: amd64\nDepends: libgtk-3-0\n');
  assert.throws(() => normalizeDesktopControl(control, '0.3.0'));
});

test('incomplete, duplicate or unexpected release assets are rejected', () => {
  const assets = ['deepblock_0.2.0_amd64.deb', 'deepblock-cli_0.2.0_amd64.deb'];
  assert.doesNotThrow(() => verifyAssets(assets, assets));
  assert.throws(() => verifyAssets(assets.slice(1), assets), /Missing/);
  assert.throws(() => verifyAssets([...assets, assets[0]], assets), /Duplicate/);
  assert.throws(() => verifyAssets([...assets, '../evil'], assets), /Unexpected/);
});
