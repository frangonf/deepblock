import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, rmdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersions, resourceDirectory, targetAssets, normalizeDesktopControl, distributionLicenseName, distributionLicensePath } from './release-core.ts';
import type { ReleaseTarget } from './release-core.ts';

// Collection can point at a separate checkout containing the built packages.
const root = process.env.DEEPBLOCK_SOURCE_DIR
  ? path.resolve(process.env.DEEPBLOCK_SOURCE_DIR)
  : fileURLToPath(new URL('../', import.meta.url));
const desktop = path.join(root, 'apps/desktop/src-tauri');
const command = process.argv[2];
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error('Unable to identify Rust host');
const explicitTarget = process.env.DEEPBLOCK_BUILD_TARGET ?? process.env.CARGO_BUILD_TARGET
  ?? (process.env.TAURI_ENV_TARGET_TRIPLE && process.env.TAURI_ENV_TARGET_TRIPLE !== host ? process.env.TAURI_ENV_TARGET_TRIPLE : undefined);
const target = explicitTarget ?? host;
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { cwd: root, encoding: 'utf8' }));
const binaries = resourceDirectory(metadata.target_directory, explicitTarget);
const version = checkVersions(root);
const targetArgs = explicitTarget ? ['--target', explicitTarget] : [];
const tauri = path.join(root, 'apps/desktop/ui/node_modules/.bin/tauri');
const run = (executable: string, args: string[], cwd = root) => execFileSync(executable, args, { cwd, stdio: 'inherit', env: process.env });
const cargo = (packages: string[]) => run('cargo', ['build', '--locked', '--release', ...targetArgs, ...packages.flatMap((name) => ['-p', name])]);
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function stage() {
  const resources = path.join(desktop, 'resources/bin');
  mkdirSync(resources, { recursive: true });
  for (const file of readdirSync(resources)) if (file !== 'KEEP') rmSync(path.join(resources, file), { recursive: true, force: true });
  writeFileSync(path.join(resources, 'README.txt'), 'DeepBlock bundled tools. Linux CLI/server are installed through separate packages. ActivityWatch is bring-your-own unless explicitly staged.\n');
  copyFileSync(path.join(root, 'LICENSE'), path.join(resources, 'LICENSE'));
  if (target.endsWith('apple-darwin')) {
    copyFileSync(distributionLicensePath(root), path.join(resources, distributionLicenseName));
    cargo(['deepblock-cli']);
    copyFileSync(path.join(binaries, 'deepb'), path.join(resources, 'deepb'));
    if (process.env.DEEPBLOCK_BUNDLE_AW === '1') {
      const architecture = 'arm64';
      for (const [name, variable] of [['aw-server-rust', 'SERVER'], ['aw-watcher-window', 'WATCHER_WINDOW'], ['aw-watcher-afk', 'WATCHER_AFK']]) {
        const source = process.env[`DEEPBLOCK_AW_${variable}_BIN`];
        const checksum = process.env[`DEEPBLOCK_AW_${variable}_SHA256`];
        if (!source || !checksum || digest(source) !== checksum) throw new Error(`Missing/unverified ActivityWatch input: ${name}`);
        run('lipo', [source, '-verify_arch', architecture]);
        copyFileSync(source, path.join(resources, name));
      }
      const license = process.env.DEEPBLOCK_AW_LICENSES;
      if (!license) throw new Error('DEEPBLOCK_AW_LICENSES is required for bundled third-party tools');
      copyFileSync(license, path.join(resources, 'ActivityWatch-LICENSES.txt'));
    }
  } else if (process.env.DEEPBLOCK_BUNDLE_AW === '1') throw new Error('Bundled ActivityWatch management is macOS-only');
}

function verifyNotice(expected: Buffer, ...locations: string[]) {
  if (!locations.some((location) => existsSync(location) && readFileSync(location).equals(expected))) {
    throw new Error(`Missing or mismatched third-party license texts: ${locations.join(' or ')}`);
  }
}

function verifyAppNotice(app: string, expected: Buffer) {
  const resources = path.join(app, 'Contents/Resources');
  verifyNotice(expected, ...['resources/bin', 'bin'].map((dir) => path.join(resources, dir, distributionLicenseName)));
}

function detachDmg(mount: string) {
  // Disk Arbitration can still have the volume open just after mounting.
  for (let attempt = 0; ; attempt += 1) {
    try {
      run('hdiutil', ['detach', mount]);
      return;
    } catch (error) {
      if (attempt === 4 || !(error instanceof Error) || !('status' in error) || error.status !== 16) throw error;
      run('sleep', ['1']);
    }
  }
}

function verifyDmgNotice(dmg: string, expected: Buffer) {
  const mount = mkdtempSync(path.join(tmpdir(), 'deepblock-dmg-'));
  try {
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    try { verifyAppNotice(path.join(mount, 'DeepBlock.app'), expected); }
    finally { detachDmg(mount); }
  } finally {
    // Never recursively delete the contents of a still-attached volume.
    if (existsSync(mount) && readdirSync(mount).length === 0) rmdirSync(mount);
  }
}

if (command === 'stage') stage();
else if (command === 'bundle') {
  const signing = target.endsWith('apple-darwin') ? ['--config', JSON.stringify({ bundle: { macOS: { signingIdentity: process.env.APPLE_SIGNING_IDENTITY || '-' } } })] : [];
  run(tauri, ['build', ...targetArgs, '--bundles', target.endsWith('apple-darwin') ? 'app,dmg' : 'deb', ...signing, '--', '--locked'], desktop);
} else if (command === 'tools') cargo(['deepblock-cli', 'deepblock-server']);
else if (command === 'collect') {
  if (!['aarch64-apple-darwin', 'x86_64-unknown-linux-gnu'].includes(target)) throw new Error(`Unsupported release target: ${target}`);
  const supportedTarget = target as ReleaseTarget;
  const output = path.resolve(process.env.DEEPBLOCK_RELEASE_DIR ?? path.join(root, 'dist/release'));
  mkdirSync(output, { recursive: true });
  const assets = targetAssets(version, supportedTarget);
  const notice = distributionLicensePath(root);
  const expectedNotice = readFileSync(notice);
  if (!expectedNotice.toString().trim()) throw new Error(`Empty third-party license texts: ${notice}`);
  // Check machine code, not just the intended target in metadata.
  for (const binary of ['deepb', 'deepblock-server']) {
    const source = path.join(binaries, binary);
    if (target.endsWith('apple-darwin')) {
      run('lipo', [source, '-verify_arch', 'arm64']);
      if (process.env.DEEPBLOCK_SIGNING === 'notarized' && !process.env.APPLE_SIGNING_IDENTITY) throw new Error('Missing Developer ID signing identity');
      run('codesign', ['--force', '--options', 'runtime', '--sign', process.env.APPLE_SIGNING_IDENTITY || '-', ...(process.env.DEEPBLOCK_SIGNING === 'notarized' ? ['--timestamp'] : []), source]);
      run('codesign', ['--verify', '--strict', source]);
    }
    else if (!/x86-64/.test(execFileSync('file', [source], { encoding: 'utf8' }))) throw new Error(`Wrong architecture: ${binary}`);
  }
  if (target.endsWith('apple-darwin')) {
    const app = path.join(binaries, 'bundle/macos/DeepBlock.app');
    verifyAppNotice(app, expectedNotice);
    run('lipo', [path.join(app, 'Contents/MacOS/deepblock-desktop'), '-verify_arch', 'arm64']);
    run('codesign', ['--verify', '--deep', '--strict', app]);
    if (process.env.DEEPBLOCK_SIGNING === 'notarized') {
      run('spctl', ['--assess', '--type', 'execute', app]);
      run('xcrun', ['stapler', 'validate', app]);
    }
    const directory = path.join(binaries, 'bundle/dmg');
    const dmgs = readdirSync(directory).filter((file) => file.endsWith('.dmg'));
    if (dmgs.length !== 1) throw new Error('Expected exactly one DMG');
    const dmg = path.join(directory, dmgs[0]);
    verifyDmgNotice(dmg, expectedNotice);
    if (process.env.DEEPBLOCK_SIGNING === 'notarized') run('xcrun', ['stapler', 'validate', dmg]);
    copyFileSync(dmg, path.join(output, assets[1]));
    run('tar', ['-czf', path.join(output, assets[2]), '-C', path.dirname(app), path.basename(app)]);
  } else {
    const directory = path.join(binaries, 'bundle/deb');
    const debs = readdirSync(directory).filter((file) => file.endsWith('.deb'));
    if (debs.length !== 1) throw new Error('Expected exactly one desktop Debian package');
    // Tauri owns bundle contents. This small adapter gives the Debian package
    // its role name and Debian's prerelease ordering (~rc < final release).
    const extracted = mkdtempSync(path.join(tmpdir(), 'deepblock-desktop-deb-'));
    try {
      run('dpkg-deb', ['--raw-extract', path.join(directory, debs[0]), extracted]);
      verifyNotice(expectedNotice, path.join(extracted, 'usr/share/doc/deepblock-desktop', distributionLicenseName));
      const control = path.join(extracted, 'DEBIAN/control');
      writeFileSync(control, normalizeDesktopControl(readFileSync(control, 'utf8'), version));
      run('dpkg-deb', ['--root-owner-group', '--build', extracted, path.join(output, assets[1])]);
    } finally { rmSync(extracted, { recursive: true, force: true }); }
    for (const asset of assets.slice(1)) {
      const file = path.join(output, asset);
      if (execFileSync('dpkg-deb', ['-f', file, 'Architecture'], { encoding: 'utf8' }).trim() !== 'amd64') throw new Error(`Wrong Debian architecture: ${asset}`);
      if (execFileSync('dpkg-deb', ['-f', file, 'Version'], { encoding: 'utf8' }).trim() !== version.replace('-', '~')) throw new Error(`Wrong Debian version: ${asset}`);
      const name = asset.split('_')[0];
      if (name === 'deepblock-desktop') continue; // Verified before repacking above.
      const files = mkdtempSync(path.join(tmpdir(), 'deepblock-tools-deb-'));
      try {
        run('dpkg-deb', ['--extract', file, files]);
        verifyNotice(expectedNotice, path.join(files, 'usr/share/doc', name, distributionLicenseName));
      } finally { rmSync(files, { recursive: true, force: true }); }
    }
  }
  run('tar', ['-czf', path.join(output, assets[0]), '-C', binaries, 'deepb', 'deepblock-server', '-C', root, 'LICENSE', 'docs/releases.md', 'docs/linux-development.md', '-C', path.dirname(notice), distributionLicenseName]);
  console.log(`Collected ${version} for ${target} in ${output}`);
} else throw new Error('Usage: node scripts/build.ts stage|bundle|tools|collect');
