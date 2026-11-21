import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';

const packages = ['deepblock-cli', 'deepblock-desktop', 'deepblock-server'];
export const releaseTargets = ['aarch64-apple-darwin', 'x86_64-unknown-linux-gnu'] as const;
export type ReleaseTarget = typeof releaseTargets[number];

export function validateVersion(version: string): string {
  // Build metadata is intentionally excluded: Debian and artifact identities
  // must have an unambiguous version. Numeric prerelease identifiers follow SemVer.
  if (semver.valid(version) !== version || version.includes('+')) throw new Error(`Invalid release version: ${version}`);
  return version;
}

function workspaceVersion(contents: string): string {
  const section = contents.match(/^\[workspace\.package\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const versions = [...(section ?? '').matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (versions.length !== 1) throw new Error('Unexpected workspace.package.version layout');
  return validateVersion(versions[0][1]);
}

function localLockVersions(contents: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const block of contents.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (!name || !packages.includes(name)) continue;
    const version = block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (!version || versions.has(name) || /^source\s*=/m.test(block)) throw new Error(`Unexpected lockfile package: ${name}`);
    versions.set(name, version);
  }
  if (versions.size !== packages.length) throw new Error('Missing local lockfile packages');
  return versions;
}

export function checkVersions(root: string): string {
  const version = workspaceVersion(readFileSync(path.join(root, 'Cargo.toml'), 'utf8'));
  const lock = localLockVersions(readFileSync(path.join(root, 'Cargo.lock'), 'utf8'));
  for (const [name, actual] of lock) if (actual !== version) throw new Error(`Version mismatch: ${name} ${actual} != ${version}`);
  for (const file of ['apps/desktop/ui/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
    const actual: unknown = JSON.parse(readFileSync(path.join(root, file), 'utf8')).version;
    if (actual !== version) throw new Error(`Version mismatch: ${file} ${String(actual)} != ${version}`);
  }
  return version;
}

export function atomicWrite(file: string, contents: string | Buffer) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { flag: 'wx' });
  try { renameSync(temporary, file); } finally { rmSync(temporary, { force: true }); }
}

const changelogRepo = 'https://github.com/frangonf/deepblock';

function bumpChangelog(contents: string, next: string, notes: string, date = new Date().toISOString().slice(0, 10)): string {
  if (!contents.startsWith('# Changelog\n')) throw new Error('Unexpected changelog layout');
  const marker = '\n## [Unreleased]\n';
  const start = contents.indexOf(marker);
  if (start === -1) throw new Error('Missing [Unreleased] changelog section');
  const rest = contents.slice(start + marker.length);
  const boundary = rest.search(/\n## |\n\[[^\]]+\]:/);
  const carried = (boundary === -1 ? rest : rest.slice(0, boundary)).trim();
  const tail = boundary === -1 ? '' : rest.slice(boundary + 1);
  const releaseBody = [notes.trim(), carried].filter(Boolean).join('\n\n');
  let updated = `${contents.slice(0, start)}\n## [Unreleased]\n\n## [${next}] - ${date}\n\n${releaseBody}\n${tail ? `\n${tail}` : ''}`.replace(/\n{3,}/g, '\n\n');
  if (/^\[Unreleased\]: /m.test(updated)) {
    const unreleasedLink = `[Unreleased]: ${changelogRepo}/compare/v${next}...HEAD`;
    updated = updated.replace(/^\[Unreleased\]: .*$/m, unreleasedLink);
    if (!updated.includes(`[${next}]:`)) updated = updated.replace(unreleasedLink, `${unreleasedLink}\n[${next}]: ${changelogRepo}/releases/tag/v${next}`);
  }
  return updated.endsWith('\n') ? updated : `${updated}\n`;
}

export function prepareVersion(root: string, next: string, notes: string, apply = false): { file: string; contents: string }[] {
  validateVersion(next);
  const previous = checkVersions(root);
  if (!semver.gt(next, previous)) throw new Error('Release version must be newer than the current version');
  if (!notes.trim()) throw new Error('Release notes are required');
  const files = ['Cargo.toml', 'Cargo.lock', 'apps/desktop/ui/package.json', 'apps/desktop/src-tauri/tauri.conf.json', 'CHANGELOG.md'];
  const changes = files.map((file) => {
    let contents = readFileSync(path.join(root, file), 'utf8');
    if (file === 'Cargo.toml') contents = contents.replace(/(^\[workspace\.package\]\s*$[\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m, `$1${next}$2`);
    else if (file === 'Cargo.lock') contents = contents.split(/(^\[\[package\]\]\s*$)/m).map((block) => {
      const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
      return name && packages.includes(name) ? block.replace(/(^version\s*=\s*")[^"]+("\s*$)/m, `$1${next}$2`) : block;
    }).join('');
    else if (file.endsWith('.json')) { const data = JSON.parse(contents); data.version = next; contents = JSON.stringify(data, null, 2) + '\n'; }
    else contents = bumpChangelog(contents, next, notes);
    return { file, contents };
  });
  if (apply) for (const change of changes) atomicWrite(path.join(root, change.file), change.contents);
  return changes;
}

export function resourceDirectory(targetDirectory: string, target?: string): string {
  if (target && !/^[a-z0-9_]+(?:-[a-z0-9_]+)+$/.test(target)) throw new Error(`Invalid target triple: ${target}`);
  return path.join(targetDirectory, ...(target ? [target] : []), 'release');
}

export function verifyAssets(actual: string[], expected: readonly string[]) {
  if (new Set(actual).size !== actual.length) throw new Error('Duplicate release assets');
  for (const name of actual) if (path.basename(name) !== name || !expected.includes(name)) throw new Error(`Unexpected release asset: ${name}`);
  for (const name of expected) if (!actual.includes(name)) throw new Error(`Missing release asset: ${name}`);
}

export function normalizeDesktopControl(control: string, version: string): string {
  validateVersion(version);
  if (!/^Package: (deep-block|deepblock|deepblock-desktop)$/m.test(control)
    || control.match(/^Version: (.+)$/m)?.[1] !== version
    || !/^Architecture: amd64$/m.test(control)) throw new Error('Unexpected desktop Debian control identity');
  return control.replace(/^Package: .+$/m, 'Package: deepblock-desktop').replace(/^Version: .+$/m, `Version: ${version.replace('-', '~')}`);
}

export function targetAssets(version: string, target: ReleaseTarget): string[] {
  validateVersion(version);
  const tools = `deepblock-tools_${version}_${target}.tar.gz`;
  return target.endsWith('apple-darwin') ? [tools, `deepblock_${version}_${target}.dmg`, `deepblock_${version}_${target}.app.tar.gz`]
    : [tools, ...['deepblock-desktop', 'deepblock-cli', 'deepblock-server'].map((name) => `${name}_${version.replace('-', '~')}_amd64.deb`)];
}
