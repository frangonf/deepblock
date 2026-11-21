import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DependencyEntry } from './licenses-core.ts';

interface LicenseFile {
  readonly directory: string;
  readonly file: string;
  readonly origin?: string;
}

interface LicenseSource extends DependencyEntry {
  readonly directory: string;
  readonly source: string;
  readonly additional?: readonly LicenseFile[];
  readonly files?: readonly string[];
}

const licenseName = /^(?:licen[cs]es?|copying|copyright(?:notice)?|ofl|unlicense)(?:$|[-_.])/i;
const noticeName = /^(?:notice|authors|third-party-(?:licenses?|notices?))(?:$|[-_.])/i;

// Exact-version exceptions for published artifacts that do not contain the full
// texts. Keep provenance beside each copy. An unreviewed upgrade must fail the
// packaging check rather than silently reusing another version's attribution.
const spdx = 'https://github.com/spdx/license-list-data/blob/v3.28.0/text';
const checkedIn: Record<string, string> = {
  'alloc-stdlib.txt': 'https://github.com/dropbox/rust-alloc-no-stdlib/blob/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE',
  'dlopen2.txt': 'https://github.com/OpenByteDev/dlopen2/blob/cc80e4a0a90d499b677fdf7743699b4b3a43a989/LICENSE',
  'libappindicator-sys.txt': 'https://static.crates.io/crates/libappindicator/libappindicator-0.9.0.crate (LICENSE-MIT; same upstream commit as libappindicator-sys 0.9.0)',
  'mac-notification-sys.txt': 'https://github.com/h4llow3En/mac-notification-sys/blob/deb559683962d314a7693478476bf8d052efa84e/LICENSE-MIT',
  'objc2.txt': 'https://github.com/madsmtm/objc2/blob/d7d2fa23ceaa5e6096c923b081040e5d81b3b9df/LICENSE.md (identical in each covered crate’s upstream commit)',
  'mit.txt': `${spdx}/MIT.txt (the terms referenced by upstream's LICENSE.md)`,
  'apache-2.0.txt': `${spdx}/Apache-2.0.txt (Apache option chosen for the tri-licensed objc2 crates)`,
  'mpl-2.0.txt': `${spdx}/MPL-2.0.txt (the terms identified in upstream’s source file headers)`,
  'tauri-plugin.txt': 'https://github.com/tauri-apps/tauri/blob/9319e539f34237035cb4693bed9246660bc0a926/LICENSE-MIT',
  'tauri-notification-js.txt': 'https://github.com/tauri-apps/plugins-workspace/blob/8c588be430d803019702f401e80b7cd5f1949aea/plugins/notification/LICENSE_MIT',
  // The npm package declares MIT; upstream subsequently published the terms
  // and attribution for the same project.
  'react-remove-scroll-bar.txt': 'https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE',
  'sqlite.txt': 'https://www.sqlite.org/copyright.html (public-domain dedication; SQLite is compiled by libsqlite3-sys)',
};
const objcMit = ['objc2.txt', 'mit.txt'];
const objcApache = ['objc2.txt', 'apache-2.0.txt'];
const supplements: Record<string, readonly string[]> = {
  'alloc-stdlib@0.3.0': ['alloc-stdlib.txt'],
  'block2@0.6.2': objcMit,
  'dispatch2@0.3.1': objcApache,
  'dlopen2@0.8.2': ['dlopen2.txt'],
  'dlopen2_derive@0.4.3': ['dlopen2.txt'],
  'libappindicator-sys@0.9.0': ['libappindicator-sys.txt'],
  'libsqlite3-sys@0.40.0': ['sqlite.txt'],
  'mac-notification-sys@0.6.15': ['mac-notification-sys.txt'],
  'objc2@0.6.5': objcMit,
  'objc2-app-kit@0.3.2': objcApache,
  'objc2-core-foundation@0.3.2': objcApache,
  'objc2-core-graphics@0.3.2': objcApache,
  'objc2-encode@4.1.0': objcMit,
  'objc2-exception-helper@0.1.1': objcApache,
  'objc2-foundation@0.3.2': objcMit,
  'objc2-quartz-core@0.3.2': objcApache,
  'objc2-web-kit@0.3.2': objcApache,
  'selectors@0.38.0': ['mpl-2.0.txt'],
  'tauri-plugin@2.7.4': ['tauri-plugin.txt'],
  '@tauri-apps/plugin-notification@2.8.1': ['tauri-notification-js.txt'],
  'react-remove-scroll-bar@2.3.8': ['react-remove-scroll-bar.txt'],
};
const nested: Record<string, readonly string[]> = {
  'aws-lc-sys@0.47.0': ['aws-lc/LICENSE', 'aws-lc/third_party/fiat/LICENSE'],
  'regex-syntax@0.8.12': ['src/unicode_tables/LICENSE-UNICODE'],
  'rfd@0.17.2': ['src/backend/xdg_desktop_portal/window_identifier/LICENSE'],
  'ring@0.17.14': ['src/polyfill/once_cell/LICENSE-APACHE', 'src/polyfill/once_cell/LICENSE-MIT', 'third_party/fiat/LICENSE'],
  'tracing-core@0.1.36': ['src/spin/LICENSE'],
};

interface CargoPackage {
  readonly name: string;
  readonly version: string;
  readonly source: string | null;
  readonly manifest_path: string;
}

interface PnpmLicensePackage {
  readonly name: string;
  readonly paths: readonly string[];
}

function packageInfo(directory: string): DependencyEntry {
  const { name, version, license } = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as DependencyEntry;
  return { name, version, license };
}

function npmSource({ name, version }: DependencyEntry): string {
  return `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
}

export function rustStandardLibrary(sysroot: string, version: string): LicenseSource {
  return {
    name: 'Rust standard library', version, license: 'MIT OR Apache-2.0',
    directory: path.join(sysroot, 'share/doc/rust'),
    files: ['COPYRIGHT-library.html', 'licenses/Apache-2.0.txt', 'licenses/MIT.txt'],
    source: `https://github.com/rust-lang/rust/tree/${version}/library`,
  };
}

export function distributionSources(root: string, cargoJson: string, shippedRust: ReadonlySet<string>, pnpmJson: string, rust: readonly DependencyEntry[], ui: readonly DependencyEntry[]): LicenseSource[] {
  const { packages } = JSON.parse(cargoJson) as { packages: CargoPackage[] };
  const cargo = new Map(packages.filter((pkg) => pkg.source !== null).map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
  const installed = new Map<string, string>();
  for (const group of Object.values(JSON.parse(pnpmJson) as Record<string, PnpmLicensePackage[]>)) {
    for (const pkg of group) for (const directory of pkg.paths) {
      const info = packageInfo(directory);
      if (info.name !== pkg.name) throw new Error(`Unexpected npm package in ${directory}: ${info.name}`);
      installed.set(`${info.name}@${info.version}`, directory);
    }
  }
  const uiModules = path.join(root, 'apps/desktop/ui/node_modules');
  // Resolve Vite's locked copy, not another consumer's Rolldown version.
  const viteManifest = realpathSync(path.join(uiModules, 'vite/package.json'));
  const rolldown = path.dirname(createRequire(viteManifest).resolve('rolldown/package.json'));
  const entries: LicenseSource[] = [
    ...rust.filter((entry) => shippedRust.has(`${entry.name}@${entry.version}`)).map((entry) => {
      const pkg = cargo.get(`${entry.name}@${entry.version}`);
      if (!pkg || pkg.source !== 'registry+https://github.com/rust-lang/crates.io-index') throw new Error(`Unexpected Cargo source: ${entry.name}@${entry.version}`);
      return { ...entry, directory: path.dirname(pkg.manifest_path), source: `https://static.crates.io/crates/${entry.name}/${entry.name}-${entry.version}.crate` };
    }),
    ...ui.map((entry) => {
      const directory = installed.get(`${entry.name}@${entry.version}`);
      if (!directory) throw new Error(`Cannot find installed UI package: ${entry.name}@${entry.version}`);
      return { ...entry, directory, source: npmSource(entry) };
    }),
    // Tailwind emits preflight CSS; Vite and Rolldown emit JS helpers.
    ...[path.join(uiModules, 'tailwindcss'), path.dirname(viteManifest), rolldown].map((directory) => {
      const entry = packageInfo(directory);
      return { ...entry, directory, source: npmSource(entry) };
    }),
    { name: 'Inter Variable', version: '4.1', license: 'OFL-1.1', directory: path.join(root, 'apps/desktop/ui/public/fonts'), source: 'https://github.com/rsms/inter/releases/tag/v4.1' },
  ];
  return entries.map((entry) => {
    const key = `${entry.name}@${entry.version}`;
    return { ...entry, additional: [
      ...(nested[key] ?? []).map((file) => ({ directory: entry.directory, file })),
      ...(supplements[key] ?? []).map((file) => ({ directory: path.join(root, 'scripts/license-texts'), file, origin: checkedIn[file] })),
    ] };
  });
}

function readText({ directory, file }: LicenseFile): string {
  const source = realpathSync(path.join(directory, file));
  if (!source.startsWith(`${realpathSync(directory)}${path.sep}`)) throw new Error(`License path escapes its package: ${file}`);
  const text = readFileSync(source, 'utf8');
  if (!text.trim()) throw new Error(`Empty license/notice file: ${file}`);
  return text;
}

export function renderDistributionLicenses(entries: readonly LicenseSource[]): string {
  const sections = [
    'DeepBlock third-party license texts',
    'This inventory covers packages for the supported Linux and macOS builds. Some build or platform-specific dependencies are not present in every binary.',
    'To obtain source files covered by MPL-2.0, see the exact crate source archive URLs below.',
  ];
  for (const { name, version, license, source, directory, additional = [], files: explicit } of entries) {
    const files = explicit ?? readdirSync(directory, { withFileTypes: true })
      .filter((file) => file.isFile() && !/\.spdx$/i.test(file.name) && (licenseName.test(file.name) || noticeName.test(file.name)))
      .map((file) => file.name).sort();
    if (!files.some((file) => licenseName.test(file)) && additional.length === 0) throw new Error(`No upstream license text for ${name}@${version}`);
    const texts = [...files.map((file) => ({ directory, file })), ...additional].map((input: LicenseFile) =>
      `--- ${input.file}${input.origin ? ` (${input.origin})` : ''} ---\n${readText(input)}`);
    sections.push(`=== ${name}@${version} (${license}) ===\nSource: ${source}\n\n${texts.join('\n\n')}`);
  }
  return `${sections.join('\n\n')}\n`;
}
