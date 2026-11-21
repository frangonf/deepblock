import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { releaseTargets, targetAssets, validateVersion, verifyAssets } from '../release-core.ts';

const runs = { numRuns: 100, seed: 20261009 };
const component = fc.integer({ min: 0, max: 100000 });
const version = fc.tuple(component, component, component,
  fc.option(fc.tuple(fc.constantFrom('alpha', 'beta', 'rc'), component), { nil: undefined }))
  .map(([major, minor, patch, prerelease]) => `${major}.${minor}.${patch}${prerelease ? `-${prerelease[0]}.${prerelease[1]}` : ''}`);

// These properties encode release policy, rather than using semver itself as
// an oracle for the same validation performed by the implementation.
test('generated canonical versions are accepted without coercion', () => {
  fc.assert(fc.property(version, (value) => {
    assert.equal(validateVersion(value), value);
  }), runs);
});

test('generated release versions reject metadata, coercion and leading-zero numeric identifiers', () => {
  fc.assert(fc.property(version, component, (value, numeric) => {
    for (const invalid of [`v${value}`, ` ${value}`, `${value} `, `${value}+build.${numeric}`, `0${value}`, `1.2.3-0${numeric}`]) {
      assert.throws(() => validateVersion(invalid), /Invalid release version/);
    }
  }), runs);
});

const inventory = version.chain((value) => fc.constantFrom(...releaseTargets).chain((target) => {
  const expected = targetAssets(value, target);
  return fc.shuffledSubarray(expected, { minLength: expected.length, maxLength: expected.length })
    .map((actual) => ({ value, target, expected, actual }));
}));

test('release inventory accepts any exact permutation and rejects missing, duplicate or substituted assets', () => {
  fc.assert(fc.property(inventory, ({ expected, actual }) => {
    assert.equal(new Set(expected).size, expected.length);
    assert.doesNotThrow(() => verifyAssets(actual, expected));
    for (const index of actual.keys()) {
      const missing = actual.filter((_, position) => position !== index);
      assert.throws(() => verifyAssets(missing, expected), /Missing/);
      assert.throws(() => verifyAssets([...actual, actual[index]], expected), /Duplicate/);
      for (const replacement of [`../${actual[index]}`, `${actual[index]}.unexpected`]) {
        const substituted = actual.map((name, position) => position === index ? replacement : name);
        assert.throws(() => verifyAssets(substituted, expected), /Unexpected/);
      }
    }
  }), runs);
});
