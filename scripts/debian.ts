// Executed on Debian only; normal macOS checks typecheck this file without running it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersions, resourceDirectory } from './release-core.ts';

if (process.platform !== 'linux') throw new Error('Debian packaging must run on the Debian build machine');
const root = fileURLToPath(new URL('../', import.meta.url));
const version = checkVersions(root).replace('-', '~');
const target = process.env.DEEPBLOCK_BUILD_TARGET ?? process.env.CARGO_BUILD_TARGET;
if (target && target !== 'x86_64-unknown-linux-gnu') throw new Error('Initial Debian packages support amd64 only');
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { cwd: root, encoding: 'utf8' }));
const binaries = resourceDirectory(metadata.target_directory, target);
const output = path.resolve(process.env.DEEPBLOCK_RELEASE_DIR ?? path.join(root, 'dist/release'));
mkdirSync(output, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'deepblock-deb-'));
const maintainer = 'DeepBlock contributors <frangonf@users.noreply.github.com>';
try {
  for (const [name, binary, description] of [
    ['deepblock-cli', 'deepb', 'Command-line client for the revision-based DeepBlock planner'],
    ['deepblock-server', 'deepblock-server', 'Local file-backed DeepBlock planning server'],
  ]) {
    const source = path.join(binaries, binary);
    const packageRoot = path.join(work, name);
    const documentation = path.join(packageRoot, 'usr/share/doc', name);
    mkdirSync(path.join(packageRoot, 'usr/bin'), { recursive: true });
    mkdirSync(path.join(packageRoot, 'DEBIAN'), { recursive: true });
    mkdirSync(documentation, { recursive: true });
    copyFileSync(source, path.join(packageRoot, 'usr/bin', binary));
    chmodSync(path.join(packageRoot, 'usr/bin', binary), 0o755);
    copyFileSync(path.join(root, 'LICENSE'), path.join(documentation, 'copyright'));
    copyFileSync(path.join(root, 'docs/linux-development.md'), path.join(documentation, 'README.md'));
    mkdirSync(path.join(work, 'debian'), { recursive: true });
    writeFileSync(path.join(work, 'debian/control'), `Source: deepblock\nSection: utils\nPriority: optional\nMaintainer: ${maintainer}\n\nPackage: ${name}\nArchitecture: amd64\nDescription: ${description}\n`);
    const dependencies = execFileSync('dpkg-shlibdeps', ['-O', '-e', source], { cwd: work, encoding: 'utf8' }).trim();
    if (!dependencies.startsWith('shlibs:Depends=')) throw new Error(`Cannot determine runtime dependencies for ${name}`);
    const control = `Package: ${name}\nVersion: ${version}\nArchitecture: amd64\nMaintainer: ${maintainer}\nSection: utils\nPriority: optional\nHomepage: https://github.com/frangonf/deepblock\nInstalled-Size: ${Math.ceil(statSync(source).size / 1024)}\nDepends: ${dependencies.slice('shlibs:Depends='.length)}, ca-certificates\nDescription: ${description}\n Planning data stays in the user's XDG directories. Installation does not start a service.\n`;
    writeFileSync(path.join(packageRoot, 'DEBIAN/control'), control);
    execFileSync('dpkg-deb', ['--root-owner-group', '--build', packageRoot, path.join(output, `${name}_${version}_amd64.deb`)], { stdio: 'inherit' });
  }
} finally { rmSync(work, { recursive: true, force: true }); }
