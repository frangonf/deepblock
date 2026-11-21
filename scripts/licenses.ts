// Dependency license gate and THIRD-PARTY-NOTICES.md generator.
//
//   node scripts/licenses.ts check     Fail when Rust or desktop-UI dependencies
//                                      carry licenses outside the accepted list.
//   node scripts/licenses.ts generate  Rewrite THIRD-PARTY-NOTICES.md from the
//                                      locked dependency graphs.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyLicenseOverrides,
  evaluateLicenseExpression,
  groupByLicense,
  noticesMatch,
  parseCargoMetadata,
  parsePnpmLicenses,
  renderNotices,
  type DependencyEntry,
} from './licenses-core.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const noticesPath = path.join(root, 'THIRD-PARTY-NOTICES.md');
const mode = process.argv[2];

// `cargo metadata` emits multi-megabyte JSON for this workspace; Node's 1 MiB
// default buffer kills the child mid-stream.
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function run(command: string, args: readonly string[]): { stdout: string; stderr: string } {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? `${result.stderr || result.stdout}`.slice(0, 2000);
    throw new Error(`\`${command} ${args.join(' ')}\` failed:\n${detail}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

if (mode !== 'check' && mode !== 'generate') {
  console.error('Usage: node scripts/licenses.ts <check|generate>');
  process.exit(2);
}

const rustEntries = applyLicenseOverrides(
  parseCargoMetadata(run('cargo', ['metadata', '--format-version', '1', '--locked']).stdout),
);

const uiEntries = applyLicenseOverrides(
  parsePnpmLicenses(run('pnpm', ['-C', 'apps/desktop/ui', 'licenses', 'list', '--prod', '--json']).stdout),
);

const renderedNotices = renderNotices(groupByLicense(rustEntries), groupByLicense(uiEntries));

if (mode === 'generate') {
  writeFileSync(noticesPath, renderedNotices);
  console.log(`licenses: wrote ${path.relative(root, noticesPath)}`);
} else {
  const failures: string[] = [];
  const sources: readonly (readonly [string, readonly DependencyEntry[]])[] = [
    ['Rust', rustEntries],
    ['UI', uiEntries],
  ];
  for (const [source, entries] of sources) {
    for (const entry of entries) {
      const verdict = evaluateLicenseExpression(entry.license);
      if (!verdict.allowed) {
        failures.push(`${source} ${entry.name}@${entry.version}: ${verdict.reason}`);
      }
    }
  }
  const existingNotices = existsSync(noticesPath) ? readFileSync(noticesPath, 'utf8') : null;
  if (existingNotices === null || !noticesMatch(existingNotices, renderedNotices)) {
    failures.push(`${path.relative(root, noticesPath)} is missing or out of date; run \`mise run licenses:notices\``);
  }
  if (failures.length > 0) {
    console.error(`licenses: ${failures.length} check failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`licenses: OK (Rust crates: ${rustEntries.length}, UI packages: ${uiEntries.length})`);
  }
}
