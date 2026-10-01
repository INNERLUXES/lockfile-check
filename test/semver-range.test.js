import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, parseRange, satisfies } from '../src/index.js';

const yes = (v, r) => assert.equal(satisfies(v, r).match, true, `${v} should satisfy "${r}"`);
const no = (v, r) => assert.equal(satisfies(v, r).match, false, `${v} should not satisfy "${r}"`);

test('parseVersion reads full versions with prerelease and build metadata, and nothing else', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
  assert.deepEqual(parseVersion('v10.0.0-beta.2+sha.5'), { major: 10, minor: 0, patch: 0, pre: ['beta', '2'] });
  for (const bad of ['1.2', '01.2.3', '1.2.3.4', 'latest', '', null, 'x'.repeat(300)]) assert.equal(parseVersion(bad), null, String(bad));
});

test('compareVersions follows Semantic Versioning precedence, prereleases included', () => {
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 0; i < order.length - 1; i += 1) {
    assert.equal(compareVersions(parseVersion(order[i]), parseVersion(order[i + 1])), -1, `${order[i]} < ${order[i + 1]}`);
  }
  assert.equal(compareVersions(parseVersion('1.0.0+a'), parseVersion('1.0.0+b')), 0);
});

test('exact versions, = and v prefixes', () => {
  yes('1.2.3', '1.2.3');
  yes('1.2.3', '=1.2.3');
  yes('1.2.3', 'v1.2.3');
  no('1.2.4', '1.2.3');
});

test('caret ranges, including 0.x and 0.0.x', () => {
  yes('1.9.9', '^1.2.3');
  no('2.0.0', '^1.2.3');
  no('1.2.2', '^1.2.3');
  yes('0.2.9', '^0.2.3');
  no('0.3.0', '^0.2.3');
  yes('0.0.3', '^0.0.3');
  no('0.0.4', '^0.0.3');
  yes('1.5.0', '^1.2');
  yes('1.0.0', '^1');
  yes('0.9.0', '^0.x');
  no('1.0.0', '^0.x');
});

test('tilde ranges', () => {
  yes('1.2.9', '~1.2.3');
  no('1.3.0', '~1.2.3');
  yes('1.2.0', '~1.2');
  yes('1.9.0', '~1');
  no('2.0.0', '~1');
  yes('1.2.5', '~>1.2.3');
});

test('comparison operators, partial versions and spaces after an operator', () => {
  yes('2.0.0', '>=1.2.3');
  no('1.2.2', '>=1.2.3');
  yes('1.3.0', '>1.2');
  no('1.2.9', '>1.2');
  no('1.2.0', '<1.2');
  yes('1.1.9', '<1.2');
  yes('1.2.9', '<=1.2');
  no('1.3.0', '<=1.2');
  yes('1.5.0', '>= 1.2.0 < 2');
  no('2.0.0', '>=1.2.0 <2');
  no('1.0.0', '>*');
});

test('x and * wildcards, partial versions and the empty range', () => {
  for (const r of ['*', 'x', 'X', '', '1.x', '1.X.x', '1', '1.*']) yes('1.4.2', r);
  no('2.0.0', '1.x');
  yes('1.2.7', '1.2.x');
  no('1.3.0', '1.2.x');
  yes('1.2.0', '1.2');
});

test('|| sets and hyphen ranges, full and partial', () => {
  yes('2.5.0', '^1.0.0 || ^2.0.0');
  no('3.0.0', '^1.0.0 || ^2.0.0');
  yes('1.2.3', '1.2.3 - 2.3.4');
  yes('2.3.4', '1.2.3 - 2.3.4');
  no('2.3.5', '1.2.3 - 2.3.4');
  yes('2.3.9', '1.2.3 - 2.3');
  no('2.4.0', '1.2.3 - 2.3');
  yes('2.9.9', '1.2 - 2');
  no('1.1.9', '1.2 - 2');
});

test('prerelease rule: a prerelease matches only when the range names the same major.minor.patch with a prerelease', () => {
  no('1.3.0-beta.1', '^1.2.0');
  no('2.0.0-rc.1', '^1.2.0');
  no('2.0.0-beta', '>1');
  yes('1.3.0-beta.1', '>=1.3.0-beta.0');
  yes('1.3.0-beta.2', '^1.3.0-beta.1');
  no('1.4.0-beta.2', '^1.3.0-beta.1');
  yes('1.4.0', '^1.3.0-beta.1');
  no('1.0.0-alpha', '*');
});

test('forms the matcher does not read are reported as unsupported, not guessed', () => {
  for (const r of ['latest', 'next', 'github:user/repo#v1', 'git+https://example.com/x.git', 'file:../lib', 'npm:other@^1.0.0', 'workspace:*', 'https://example.com/x.tgz', 'user/repo', '1.2.3 -- 2', '>=1.2.3 <banana']) {
    const s = satisfies('1.2.3', r);
    assert.equal(s.ok, false, r);
    assert.equal(typeof s.reason, 'string');
  }
  assert.equal(parseRange('x'.repeat(300)).ok, false);
  assert.equal(satisfies('not-a-version', '^1.0.0').ok, false);
  assert.deepEqual(parseRange('^1.0.0').ok, true);
});
