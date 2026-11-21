import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('aggregate build covers the desktop through the workspace without a second Cargo task', () => {
  const tasks = readFileSync(new URL('../../mise.toml', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../../Cargo.toml', import.meta.url), 'utf8');
  const aggregate = tasks.match(/^\[tasks.build\]\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  assert.ok(aggregate);
  assert.match(aggregate, /depends = \["build:rust", "build:web"\]/);
  assert.match(tasks, /\[tasks\."build:rust"\]\ndescription = "[^\n]*"\nrun = "cargo build --locked --workspace"/);
  assert.match(workspace, /members = \[[^\]]*"apps\/desktop\/src-tauri"/);
  // Retain the standalone focused task for developers who request it directly.
  assert.match(tasks, /\[tasks\."build:desktop"\]/);
});

const target = 'aarch64-apple-darwin';
const upstreamTerms = 'example crate\nCopyright the upstream authors\nPermission is hereby granted…\n';
const appNotice = 'bundle/macos/DeepBlock.app/Contents/Resources/resources/bin/THIRD-PARTY-LICENSES.txt';

function fixture(buildTarget = target) {
  const root = mkdtempSync(path.join(tmpdir(), 'deepblock-build-'));
  for (const dir of ['scripts', 'bin', 'docs', 'apps/desktop/ui', 'apps/desktop/src-tauri']) mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ['build.ts', 'debian.ts', 'release-core.ts']) copyFileSync(new URL(`../${file}`, import.meta.url), path.join(root, 'scripts', file));
  symlinkSync(path.resolve(import.meta.dirname, '../../node_modules'), path.join(root, 'node_modules'), 'dir');
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(root, 'Cargo.toml'), '[workspace.package]\nversion = "0.2.0"\n');
  writeFileSync(path.join(root, 'Cargo.lock'), ['deepblock-cli', 'deepblock-server', 'deepblock-desktop'].map((name) => `[[package]]\nname = "${name}"\nversion = "0.2.0"\n`).join('\n'));
  for (const file of ['apps/desktop/ui/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) writeFileSync(path.join(root, file), '{"version":"0.2.0"}');
  for (const file of ['LICENSE', 'docs/releases.md', 'docs/linux-development.md']) writeFileSync(path.join(root, file), `Source snapshot: ${file}\n`);
  mkdirSync(path.join(root, 'dist/licenses'), { recursive: true });
  writeFileSync(path.join(root, 'dist/licenses/THIRD-PARTY-LICENSES.txt'), upstreamTerms);
  const binaries = path.join(root, 'custom-target', buildTarget, 'release');
  const app = path.join(binaries, 'bundle/macos/DeepBlock.app');
  mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  mkdirSync(path.dirname(path.join(binaries, appNotice)), { recursive: true });
  writeFileSync(path.join(binaries, appNotice), upstreamTerms);
  mkdirSync(path.join(binaries, 'bundle/dmg'), { recursive: true });
  for (const file of ['deepb', 'deepblock-server', 'bundle/macos/DeepBlock.app/Contents/MacOS/deepblock-desktop']) writeFileSync(path.join(binaries, file), 'arm64');
  writeFileSync(path.join(binaries, 'bundle/dmg/DeepBlock.dmg'), 'DMG fixture');
  // Only external platform tools are substituted. Exercise the real collector,
  // filesystem and tar; Xcode lipo consumes every argument after -verify_arch
  // as an architecture, unlike the more permissive LLVM lipo on newer macOS.
  const tool = path.join(root, 'bin/tool.mjs');
  writeFileSync(tool, `#!${process.execPath}
import path from 'node:path';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
switch (path.basename(process.argv[1])) {
  case 'rustc': console.log('host: ${buildTarget}'); break;
  case 'cargo':
    if (args[0] === 'metadata') console.log(JSON.stringify({ target_directory: process.env.TEST_TARGET_DIRECTORY }));
    break;
  case 'lipo':
    if (args.length !== 3 || args[1] !== '-verify_arch' || args[2] !== 'arm64') {
      console.error('Xcode lipo: expected input_file -verify_arch arm64'); process.exit(1);
    }
    if (readFileSync(args[0], 'utf8') !== args[2]) {
      console.error('Wrong architecture'); process.exit(1);
    }
    break;
  case 'codesign':
    if (args[0] === '--verify' && path.basename(args.at(-1)) === process.env.TEST_VERIFY_FAIL) {
      console.error('Invalid standalone signature'); process.exit(1);
    }
    break;
  case 'hdiutil':
    if (args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1];
      cpSync(path.join(path.dirname(args.at(-1)), '../macos/DeepBlock.app'), path.join(mount, 'DeepBlock.app'), { recursive: true });
      if (process.env.TEST_DMG_NOTICE) writeFileSync(path.join(mount, 'DeepBlock.app/Contents/Resources/resources/bin/THIRD-PARTY-LICENSES.txt'), process.env.TEST_DMG_NOTICE);
    } else if (args[0] === 'detach') rmSync(path.join(args[1], 'DeepBlock.app'), { recursive: true });
    else throw new Error('Unexpected hdiutil argument');
    break;
  case 'dpkg-shlibdeps': console.log('shlibs:Depends=libc6'); break;
  default: throw new Error('Unexpected tool');
}
`);
  chmodSync(tool, 0o755);
  for (const name of ['rustc', 'cargo', 'lipo', 'codesign', 'hdiutil', 'dpkg-shlibdeps']) symlinkSync(tool, path.join(root, 'bin', name));
  const run = (command = 'collect', script = path.join(root, 'scripts/build.ts'), extraEnv: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [script, command], {
    cwd: root, encoding: 'utf8', env: {
      ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
      DEEPBLOCK_BUILD_TARGET: buildTarget, CARGO_BUILD_TARGET: undefined, TAURI_ENV_TARGET_TRIPLE: undefined,
      DEEPBLOCK_RELEASE_DIR: undefined, DEEPBLOCK_SOURCE_DIR: undefined, DEEPBLOCK_SIGNING: 'adhoc',
      DEEPBLOCK_BUNDLE_AW: undefined, TEST_VERIFY_FAIL: undefined, TEST_TARGET_DIRECTORY: path.join(root, 'custom-target'), ...extraEnv,
    },
  });
  return { root, binaries, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('macOS collection accepts Xcode lipo syntax and packages the selected target', () => {
  const { root, run, cleanup } = fixture();
  try {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const output = path.join(root, 'dist/release');
    assert.deepEqual(readdirSync(output).sort(), [
      'deepblock-tools_0.2.0_aarch64-apple-darwin.tar.gz',
      'deepblock_0.2.0_aarch64-apple-darwin.app.tar.gz',
      'deepblock_0.2.0_aarch64-apple-darwin.dmg',
    ]);
    const contents = execFileSync('tar', ['-tzf', path.join(output, 'deepblock-tools_0.2.0_aarch64-apple-darwin.tar.gz')], { encoding: 'utf8' });
    assert.deepEqual(contents.trim().split('\n'), ['deepb', 'deepblock-server', 'LICENSE', 'docs/releases.md', 'docs/linux-development.md', 'THIRD-PARTY-LICENSES.txt']);
    const upstream = execFileSync('tar', ['-xOzf', path.join(output, 'deepblock-tools_0.2.0_aarch64-apple-darwin.tar.gz'), 'THIRD-PARTY-LICENSES.txt'], { encoding: 'utf8' });
    assert.equal(upstream, upstreamTerms);
    const appArchive = path.join(output, 'deepblock_0.2.0_aarch64-apple-darwin.app.tar.gz');
    const archivedAppNotice = appNotice.replace('bundle/macos/', '');
    assert.equal(execFileSync('tar', ['-xOzf', appArchive, archivedAppNotice], { encoding: 'utf8' }), upstreamTerms);
  } finally { cleanup(); }
});

test('desktop resource staging copies the upstream license texts', () => {
  const { root, run, cleanup } = fixture();
  try {
    const result = run('stage');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(root, 'apps/desktop/src-tauri/resources/bin/THIRD-PARTY-LICENSES.txt'), 'utf8'), upstreamTerms);
  } finally { cleanup(); }
});

test('collection refuses a stale copy of the notices inside the packaged DMG', () => {
  const { root, run, cleanup } = fixture();
  try {
    const result = run('collect', undefined, { TEST_DMG_NOTICE: 'stale notices' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing or mismatched third-party license texts/);
    assert.deepEqual(readdirSync(path.join(root, 'dist/release')), []);
  } finally { cleanup(); }
});

test('optional ActivityWatch staging accepts Xcode lipo syntax after checksum verification', () => {
  const { root, binaries, run, cleanup } = fixture();
  try {
    const source = path.join(binaries, 'deepb');
    const checksum = createHash('sha256').update(readFileSync(source)).digest('hex');
    const env: NodeJS.ProcessEnv = { DEEPBLOCK_BUNDLE_AW: '1', DEEPBLOCK_AW_LICENSES: path.join(root, 'LICENSE') };
    for (const name of ['SERVER', 'WATCHER_WINDOW', 'WATCHER_AFK']) {
      env[`DEEPBLOCK_AW_${name}_BIN`] = source;
      env[`DEEPBLOCK_AW_${name}_SHA256`] = checksum;
    }
    const result = run('stage', undefined, env);
    assert.equal(result.status, 0, result.stderr);
    for (const name of ['aw-server-rust', 'aw-watcher-window', 'aw-watcher-afk']) {
      assert.equal(readFileSync(path.join(root, 'apps/desktop/src-tauri/resources/bin', name), 'utf8'), 'arm64');
    }
  } finally { cleanup(); }
});

test('a separately checked-out collector packages the explicit source snapshot, not its own checkout', () => {
  const { root, run, cleanup } = fixture();
  try {
    const tooling = path.join(root, 'workflow-tooling');
    mkdirSync(path.join(tooling, 'scripts'), { recursive: true });
    for (const file of ['build.ts', 'release-core.ts']) copyFileSync(new URL(`../${file}`, import.meta.url), path.join(tooling, 'scripts', file));
    const sourceScript = readFileSync(path.join(root, 'scripts/build.ts'), 'utf8');
    const result = run('collect', path.join(tooling, 'scripts/build.ts'), { DEEPBLOCK_SOURCE_DIR: root });
    assert.equal(result.status, 0, result.stderr);
    const notes = execFileSync('tar', ['-xOzf', path.join(root, 'dist/release/deepblock-tools_0.2.0_aarch64-apple-darwin.tar.gz'), 'docs/releases.md'], { encoding: 'utf8' });
    assert.equal(notes, 'Source snapshot: docs/releases.md\n');
    assert.equal(readFileSync(path.join(root, 'scripts/build.ts'), 'utf8'), sourceScript);
  } finally { cleanup(); }
});

test('collection rejects wrong-architecture tools before creating archives', () => {
  const { root, binaries, run, cleanup } = fixture();
  try {
    writeFileSync(path.join(binaries, 'deepb'), 'x86_64');
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Wrong architecture/);
    assert.deepEqual(readdirSync(path.join(root, 'dist/release')), []);
  } finally { cleanup(); }
});

test('collection refuses an invalid standalone tool signature before creating archives', () => {
  const { root, run, cleanup } = fixture();
  try {
    const result = run('collect', undefined, { TEST_VERIFY_FAIL: 'deepb' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid standalone signature/);
    assert.deepEqual(readdirSync(path.join(root, 'dist/release')), []);
  } finally { cleanup(); }
});

test('each headless Debian package contains the upstream license texts', { skip: process.platform !== 'linux' || spawnSync('dpkg-deb', ['--version']).status !== 0 }, () => {
  const { root, run, cleanup } = fixture('x86_64-unknown-linux-gnu');
  try {
    const result = run('', path.join(root, 'scripts/debian.ts'));
    assert.equal(result.status, 0, result.stderr);
    for (const name of ['deepblock-cli', 'deepblock-server']) {
      const extracted = path.join(root, name);
      execFileSync('dpkg-deb', ['--extract', path.join(root, 'dist/release', `${name}_0.2.0_amd64.deb`), extracted]);
      assert.equal(readFileSync(path.join(extracted, 'usr/share/doc', name, 'THIRD-PARTY-LICENSES.txt'), 'utf8'), upstreamTerms);
    }
  } finally { cleanup(); }
});

test('Tauri bundling forwards --locked to Cargo', () => {
  const { root, run, cleanup } = fixture();
  try {
    const directory = path.join(root, 'apps/desktop/ui/node_modules/.bin');
    mkdirSync(directory, { recursive: true });
    const tauri = path.join(directory, 'tauri');
    writeFileSync(tauri, `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.at(-2) !== '--' || args.at(-1) !== '--locked') { console.error('Cargo lockfile enforcement missing'); process.exit(1); }\n`);
    chmodSync(tauri, 0o755);
    const result = run('bundle');
    assert.equal(result.status, 0, result.stderr);
  } finally { cleanup(); }
});

test('collection refuses mismatched explicit source versions', () => {
  const { root, run, cleanup } = fixture();
  try {
    writeFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), '{"version":"9.0.0"}');
    const result = run('collect', undefined, { DEEPBLOCK_SOURCE_DIR: root });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Version mismatch/);
  } finally { cleanup(); }
});
