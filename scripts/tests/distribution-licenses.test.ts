import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renderDistributionLicenses } from '../distribution-licenses.ts';

test('distribution texts include the exact upstream copyright, supplemental notice, and source location', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'deepblock-license-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const copyright = 'Copyright (c) 2020 Example authors\nPermission is hereby granted to redistribute under these terms.\n';
  const notice = 'This product includes Example work by the original contributors.\n';
  writeFileSync(path.join(directory, 'LICENSE.md'), copyright);
  writeFileSync(path.join(directory, 'NOTICE'), notice);
  writeFileSync(path.join(directory, 'THIRD-PARTY-LICENSE'), 'Copyright (c) downstream third-party contributors\n');
  writeFileSync(path.join(directory, 'README.md'), 'Not a license file.');
  const source = 'https://static.crates.io/crates/example/example-1.2.3.crate';
  const rendered = renderDistributionLicenses([{ name: 'example', version: '1.2.3', license: 'MIT', source, directory }]);
  assert.ok(rendered.includes('example@1.2.3'));
  assert.ok(rendered.includes(source));
  assert.ok(rendered.includes(copyright));
  assert.ok(rendered.includes(notice));
  assert.ok(rendered.includes('Copyright (c) downstream third-party contributors'));
  assert.ok(!rendered.includes('Not a license file.'));
});

test('a package with SPDX metadata but no upstream terms blocks distribution', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'deepblock-license-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'LICENSE.spdx'), 'SPDX-License-Identifier: MIT\n');
  writeFileSync(path.join(directory, 'NOTICE'), 'A notice alone is not the redistribution terms.\n');
  assert.throws(() => renderDistributionLicenses([{
    name: 'example', version: '1.2.3', license: 'MIT', source: 'https://example.com/', directory,
  }]), /No upstream license text for example@1\.2\.3/);
});
