// License-policy core shared by scripts/licenses.ts and its tests.
// Pure functions only: no process or filesystem access.

export interface LicenseVerdict {
  readonly allowed: boolean;
  readonly reason: string;
}

// Permissive licenses accepted in DeepBlock distributions. MPL-2.0 is weak,
// file-level copyleft: binaries may bundle it while the covered files remain
// available from their upstream sources (crates.io and each crate repository).
export const ALLOWED_LICENSES: readonly string[] = [
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-2-Clause-Patent',
  'BSD-3-Clause',
  'BSD-3-Clause-Clear',
  'CC0-1.0',
  'CDLA-Permissive-2.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Unicode-3.0',
  'Unlicense',
  'Zlib',
];

export const ALLOWED_LICENSE_EXCEPTIONS: readonly string[] = ['LLVM-exception'];

const allowedLookup = new Map<string, string>(ALLOWED_LICENSES.map((id) => [id.toLowerCase(), id]));
const exceptionLookup = new Set(ALLOWED_LICENSE_EXCEPTIONS.map((id) => id.toLowerCase()));
const MISSING_LICENSE = new Set(['', 'none', 'noassertion', 'unknown', 'n/a']);

/**
 * Evaluate an SPDX license expression against the allow list. `OR` accepts any
 * allowed branch, `AND` requires every branch to be allowed, `WITH` accepts
 * only known exceptions, and anything unparseable is rejected for manual
 * review.
 */
export function evaluateLicenseExpression(raw: string): LicenseVerdict {
  const expression = raw.trim();
  if (MISSING_LICENSE.has(expression.toLowerCase())) {
    return { allowed: false, reason: `missing license metadata (${JSON.stringify(raw)})` };
  }
  // Some crates publish slash-separated alternatives (`MIT/Apache-2.0`).
  const normalized = expression.replaceAll('/', ' OR ').replaceAll('||', ' OR ');
  const node = tryParse(normalized);
  if (node === null) {
    return { allowed: false, reason: `unparseable license expression: "${expression}"` };
  }
  const reason = evaluateNode(node, expression);
  return reason === null
    ? { allowed: true, reason: 'composed of allowed licenses' }
    : { allowed: false, reason };
}

type Token = { readonly kind: 'id' | 'keyword' | 'paren'; readonly value: string };
type LicenseNode =
  | { readonly kind: 'or'; readonly children: readonly LicenseNode[] }
  | { readonly kind: 'and'; readonly children: readonly LicenseNode[] }
  | { readonly kind: 'license'; readonly id: string; readonly exception?: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of expression.match(/\(|\)|[^\s()]+/g) ?? []) {
    if (raw === '(' || raw === ')') tokens.push({ kind: 'paren', value: raw });
    else if (['and', 'or', 'with'].includes(raw.toLowerCase())) tokens.push({ kind: 'keyword', value: raw.toLowerCase() });
    else if (/^[A-Za-z0-9.+-]+$/.test(raw)) tokens.push({ kind: 'id', value: raw });
    else throw new SyntaxError(`unexpected token ${JSON.stringify(raw)}`);
  }
  return tokens;
}

function tryParse(normalized: string): LicenseNode | null {
  try {
    return parseExpression(tokenize(normalized));
  } catch {
    return null;
  }
}

function parseExpression(tokens: readonly Token[]): LicenseNode | null {
  let index = 0;
  const parseOr = (): LicenseNode | null => {
    const left = parseAnd();
    if (left === null) return null;
    const children = [left];
    while (tokens[index]?.kind === 'keyword' && tokens[index].value === 'or') {
      index += 1;
      const right = parseAnd();
      if (right === null) return null;
      children.push(right);
    }
    return children.length === 1 ? left : { kind: 'or', children };
  };
  const parseAnd = (): LicenseNode | null => {
    const left = parseWith();
    if (left === null) return null;
    const children = [left];
    while (tokens[index]?.kind === 'keyword' && tokens[index].value === 'and') {
      index += 1;
      const right = parseWith();
      if (right === null) return null;
      children.push(right);
    }
    return children.length === 1 ? left : { kind: 'and', children };
  };
  const parseWith = (): LicenseNode | null => {
    const token = tokens[index];
    if (token === undefined) return null;
    if (token.kind === 'paren' && token.value === '(') {
      index += 1;
      const inner = parseOr();
      if (inner === null || tokens[index]?.value !== ')') return null;
      index += 1;
      return inner;
    }
    if (token.kind !== 'id') return null;
    index += 1;
    if (tokens[index]?.kind === 'keyword' && tokens[index].value === 'with') {
      const exception = tokens[index + 1];
      if (exception?.kind !== 'id') return null;
      index += 2;
      return { kind: 'license', id: token.value, exception: exception.value };
    }
    return { kind: 'license', id: token.value };
  };
  const node = parseOr();
  return node !== null && index === tokens.length ? node : null;
}

function evaluateNode(node: LicenseNode, expression: string): string | null {
  if (node.kind === 'or') {
    const failures = node.children.map((child) => evaluateNode(child, expression)).filter((reason) => reason !== null);
    return failures.length === node.children.length ? `no allowed alternative in: "${expression}"` : null;
  }
  if (node.kind === 'and') {
    const failure = node.children.map((child) => evaluateNode(child, expression)).find((reason) => reason !== null);
    return failure ?? null;
  }
  const id = allowedLookup.get(node.id.toLowerCase());
  if (id === undefined) return `license not in the accepted list: ${node.id}`;
  if (node.exception !== undefined) {
    return exceptionLookup.has(node.exception.toLowerCase())
      ? null
      : `exception not in the accepted list: ${node.exception}`;
  }
  return null;
}

// Keep the existing English ordering regardless of the host's locale.
const licenseCollator = new Intl.Collator('en-US');

export interface DependencyEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
}

interface CargoMetadataPackage {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  license?: unknown;
}

interface CargoMetadata {
  workspace_members?: unknown;
  packages?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Extract non-workspace dependency entries from `cargo metadata` JSON output. */
export function parseCargoMetadata(json: string): DependencyEntry[] {
  const metadata = JSON.parse(json) as CargoMetadata;
  const workspace = new Set(
    Array.isArray(metadata.workspace_members) ? metadata.workspace_members.map(asString) : [],
  );
  const packages = Array.isArray(metadata.packages) ? (metadata.packages as CargoMetadataPackage[]) : [];
  return packages
    .filter((pkg) => !workspace.has(asString(pkg.id)))
    .map((pkg) => ({ name: asString(pkg.name), version: asString(pkg.version), license: asString(pkg.license) }))
    .sort((a, b) => licenseCollator.compare(a.name, b.name) || licenseCollator.compare(a.version, b.version));
}

interface PnpmLicenseGroup {
  name?: unknown;
  versions?: unknown;
}

/** Flatten `pnpm licenses list --prod --json` output into one entry per package version. */
export function parsePnpmLicenses(json: string): DependencyEntry[] {
  const groups = JSON.parse(json) as Record<string, unknown>;
  const entries: DependencyEntry[] = [];
  for (const [license, packages] of Object.entries(groups)) {
    if (!Array.isArray(packages)) continue;
    for (const pkg of packages as PnpmLicenseGroup[]) {
      const name = asString(pkg.name);
      const versions = Array.isArray(pkg.versions) ? pkg.versions.map(asString) : [];
      for (const version of versions) entries.push({ name, version, license });
    }
  }
  return entries.sort((a, b) => licenseCollator.compare(a.name, b.name) || licenseCollator.compare(a.version, b.version));
}

// Registry metadata occasionally omits the license field of an otherwise
// permissively licensed package. Each override records the license verified
// from the exact locked artifact.
export const PACKAGE_LICENSE_OVERRIDES: Readonly<Record<string, string>> = {
  // package/LICENSE in https://registry.npmjs.org/@schedule-x/resize/-/resize-3.7.3.tgz is MIT.
  // The tarball matches pnpm-lock.yaml's integrity:
  // sha512-rdzsBx6Dw7d7jwYb8IQzphTwxAofegn1caVaWEdv9WTj8RkLzDILgpM2Oe6KHtpgjMcUWs6aKBaPirJh0T9VZg==
  '@schedule-x/resize@3.7.3': 'MIT',
};

export function applyLicenseOverrides(entries: readonly DependencyEntry[]): DependencyEntry[] {
  return entries.map((entry) => {
    if (!MISSING_LICENSE.has(entry.license.trim().toLowerCase())) return entry;
    const override = PACKAGE_LICENSE_OVERRIDES[`${entry.name}@${entry.version}`];
    return override === undefined ? entry : { ...entry, license: override };
  });
}

export interface LicenseGroup {
  readonly license: string;
  readonly packages: readonly string[];
}

export function groupByLicense(entries: readonly DependencyEntry[]): LicenseGroup[] {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const key = entry.license.trim() === '' ? 'NO LICENSE METADATA' : entry.license.trim();
    const packages = groups.get(key) ?? [];
    packages.push(`${entry.name}@${entry.version}`);
    groups.set(key, packages);
  }
  return [...groups.entries()]
    .map(([license, packages]) => ({ license, packages: [...packages].sort() }))
    .sort((a, b) => licenseCollator.compare(a.license, b.license));
}

const LICENSE_NOTES: readonly (readonly [string, string])[] = [
  [
    'MPL-2.0',
    'MPL-2.0 is file-level copyleft. Bundling these packages in DeepBlock binaries is permitted; the covered files remain available from their crates.io sources and upstream repositories.',
  ],
  [
    'LLVM-exception',
    'Packages under `Apache-2.0 WITH LLVM-exception` add the permissive LLVM exception to Apache-2.0; both texts ship with the package source.',
  ],
  [
    'CDLA-Permissive-2.0',
    'CDLA-Permissive-2.0 is a permissive attribution license covering the bundled CA certificate data (`webpki-root-certs`).',
  ],
];

/** Render the deterministic THIRD-PARTY-NOTICES.md content. */
export function renderNotices(rust: readonly LicenseGroup[], ui: readonly LicenseGroup[]): string {
  const lines: string[] = [
    '# Third-party notices',
    '',
    'DeepBlock is licensed under the [MIT License](LICENSE). This inventory lists the third-party license metadata reported by Cargo and pnpm. The Rust workspace list includes development, build, and platform-specific crates, so not every entry is shipped. This inventory does not replace the upstream license texts and notices required for distribution.',
    '',
    'Regenerate this file after dependency changes with `mise run licenses:notices`. `mise run licenses:check` rejects out-of-policy licenses and a missing or stale inventory.',
    '',
    '## Rust dependencies (Cargo workspace)',
    '',
  ];
  appendGroups(lines, rust);
  lines.push('## Desktop UI dependencies (production)', '');
  appendGroups(lines, ui);
  const notes = LICENSE_NOTES.filter(([marker]) =>
    [...rust, ...ui].some((group) => group.license.includes(marker)),
  );
  if (notes.length > 0) {
    lines.push('## Notes on specific licenses', '');
    for (const [, note] of notes) lines.push(`- ${note}`);
  }
  while (lines.at(-1) === '') lines.pop();
  return `${lines.join('\n')}\n`;
}

function appendGroups(lines: string[], groups: readonly LicenseGroup[]): void {
  for (const group of groups) {
    lines.push(`### ${group.license} (${group.packages.length} ${group.packages.length === 1 ? 'package' : 'packages'})`, '');
    lines.push(group.packages.map((pkg) => `\`${pkg}\``).join(', '));
    lines.push('');
  }
}

export function noticesMatch(existing: string, rendered: string): boolean {
  return existing.replaceAll('\r\n', '\n') === rendered.replaceAll('\r\n', '\n');
}
