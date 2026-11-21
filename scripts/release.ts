// Validate package versions and write checksums for the complete QA download.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkVersions, prepareVersion, releaseTargets, targetAssets, verifyAssets } from './release-core.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { positionals, values } = parseArgs({ allowPositionals: true, options: { version: { type: 'string' }, notes: { type: 'string' }, apply: { type: 'boolean' }, directory: { type: 'string' } } });
const command = positionals[0] ?? 'check';
const version = checkVersions(root);

if (command === 'check') {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { cwd: root, encoding: 'utf8' }));
  for (const member of metadata.packages) if (metadata.workspace_members.includes(member.id) && member.version !== version) throw new Error(`Inherited crate version mismatch: ${member.name}`);
  console.log(`DeepBlock ${version}: product versions agree`);
} else if (command === 'prepare') {
  if (!values.version || !values.notes) throw new Error('prepare requires --version VERSION --notes FILE [--apply]; default is dry-run');
  const changes = prepareVersion(root, values.version, readFileSync(path.resolve(values.notes), 'utf8'), values.apply);
  console.log(`${values.apply ? 'Updated' : 'Would update'} ${version} -> ${values.version}:\n${changes.map((change) => change.file).join('\n')}\nReview the diff before committing. No commits, tags or releases were created.`);
} else if (command === 'assets') {
  const directory = path.resolve(values.directory ?? process.env.DEEPBLOCK_RELEASE_DIR ?? path.join(root, 'dist/release'));
  const expected = releaseTargets.flatMap((target) => targetAssets(version, target));
  verifyAssets(readdirSync(directory).filter((name) => name !== 'SHA256SUMS'), expected);
  const sums = expected.sort().map((name) => {
    const file = path.join(directory, name);
    if (!lstatSync(file).isFile() || !lstatSync(file).size) throw new Error(`Invalid/empty artifact: ${name}`);
    return `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${name}`;
  });
  writeFileSync(path.join(directory, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log('Complete asset set verified; SHA256SUMS written.');
} else throw new Error('Usage: node scripts/release.ts check|prepare|assets');
