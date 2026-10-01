import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS, LOCK_VERSIONS, readBounded, parseJson, nameFromPath, parseLock, parsePackageJson, keyLines } from '../src/index.js';
import { withFiles, entry, lockV3, SRI } from './helpers.js';

test('nameFromPath takes the part after the last node_modules/, scopes included; folders have no name', () => {
  assert.equal(nameFromPath('node_modules/a'), 'a');
  assert.equal(nameFromPath('node_modules/a/node_modules/@scope/b'), '@scope/b');
  assert.equal(nameFromPath('packages/api/node_modules/c'), 'c');
  assert.equal(nameFromPath('packages/api'), null);
});

test('lockfileVersion 3: the packages map, with flags, the root and workspace folders', () => {
  const lock = parseLock(lockV3({
    'node_modules/a': entry('a', '1.0.0', { dev: true, hasInstallScript: true, deprecated: 'old' }),
    'node_modules/b': entry('b', '2.0.0', { devOptional: true }),
    'node_modules/ws': { resolved: 'packages/ws', link: true },
    'packages/ws': { name: 'ws', version: '0.1.0' }
  }, { dependencies: { a: '^1.0.0' }, devDependencies: { b: '^2.0.0' } }));
  assert.deepEqual(LOCK_VERSIONS, [1, 2, 3]);
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages.map((p) => [p.path, p.name, p.dev, p.optional, p.link]), [
    ['node_modules/a', 'a', true, false, false],
    ['node_modules/b', 'b', true, true, false],
    ['node_modules/ws', 'ws', false, false, true]
  ]);
  assert.equal(lock.packages[0].hasInstallScript, true);
  assert.equal(lock.packages[0].deprecated, 'old');
  assert.deepEqual(lock.workspaces, [{ path: 'packages/ws', name: 'ws', version: '0.1.0' }]);
  assert.deepEqual(lock.root.dependencies, { a: '^1.0.0' });
  assert.equal(lock.root.recorded, true);
  assert.equal(lock.hasLicenses, true);
});

test('lockfileVersion 2 is read from "packages", not from its "dependencies" copy', () => {
  const doc = { ...lockV3({ 'node_modules/a': entry('a', '1.0.0') }), lockfileVersion: 2, dependencies: { a: { version: '9.9.9' }, z: { version: '1.0.0' } } };
  const lock = parseLock(doc);
  assert.equal(lock.lockfileVersion, 2);
  assert.deepEqual(lock.packages.map((p) => `${p.name}@${p.version}`), ['a@1.0.0']);
});

test('lockfileVersion 1: the nested dependencies tree, git and file sources kept from "version", with a note', () => {
  const lock = parseLock({
    name: 'old-app', version: '1.0.0', lockfileVersion: 1, requires: true,
    dependencies: {
      a: { version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: SRI, dependencies: { b: { version: '2.0.0', resolved: 'https://registry.npmjs.org/b/-/b-2.0.0.tgz', integrity: SRI, bundled: true } } },
      g: { version: 'github:user/g#abc', from: 'github:user/g' },
      l: { version: 'file:../l' },
      d: { version: '3.0.0', dev: true, optional: true, integrity: SRI }
    }
  });
  assert.deepEqual(lock.packages.map((p) => p.path), ['node_modules/a', 'node_modules/a/node_modules/b', 'node_modules/g', 'node_modules/l', 'node_modules/d']);
  const g = lock.packages[2];
  assert.equal(g.resolved, 'github:user/g#abc');
  assert.equal(g.version, null);
  assert.equal(lock.packages[3].local, true);
  assert.equal(lock.packages[1].inBundle, true);
  assert.equal(lock.packages[4].dev && lock.packages[4].optional, true);
  assert.equal(lock.root.recorded, false);
  assert.equal(lock.hasLicenses, false);
  assert.match(lock.notes[0], /lockfileVersion 1/);
});

test('parseLock refuses other files and versions, and more entries than the limit', () => {
  assert.throws(() => parseLock([]), /expected a JSON object/);
  assert.throws(() => parseLock({ name: 'x' }), /lockfileVersion null is not supported/);
  assert.throws(() => parseLock({ lockfileVersion: 4, packages: {} }), /lockfileVersion 4 is not supported/);
  assert.throws(() => parseLock({ lockfileVersion: 3 }), /without a "packages" object/);
  assert.throws(() => parseLock({ lockfileVersion: 1 }), /without a "dependencies" object/);
  assert.throws(() => parseLock(lockV3({ 'node_modules/a': 'nope' })), /is not an object/);
  const many = {};
  for (let i = 0; i < 12; i += 1) many[`node_modules/p${i}`] = entry(`p${i}`, '1.0.0');
  assert.throws(() => parseLock(lockV3(many), 'lock', { ...LIMITS, maxPackages: 10 }), /over the limit of 10/);
  const tree = {};
  for (let i = 0; i < 12; i += 1) tree[`p${i}`] = { version: '1.0.0' };
  assert.throws(() => parseLock({ lockfileVersion: 1, dependencies: tree }, 'lock', { ...LIMITS, maxPackages: 10 }), /over the limit/);
});

test('parsePackageJson reads the three dependency lists and both forms of workspaces', () => {
  const p = parsePackageJson({ name: 'x', dependencies: { a: '^1.0.0', bad: 5 }, devDependencies: { b: '2' }, workspaces: ['packages/*'] });
  assert.deepEqual(p.dependencies, { a: '^1.0.0' });
  assert.deepEqual(p.devDependencies, { b: '2' });
  assert.deepEqual(p.optionalDependencies, {});
  assert.deepEqual(p.workspaces, ['packages/*']);
  assert.deepEqual(parsePackageJson({ workspaces: { packages: ['apps/*'] } }).workspaces, ['apps/*']);
  assert.throws(() => parsePackageJson({ dependencies: [] }), /"dependencies" must be an object/);
  assert.throws(() => parsePackageJson('x'), /expected a JSON object/);
});

test('keyLines finds the line where each entry starts, first one wins', () => {
  const text = JSON.stringify(lockV3({ 'node_modules/a': entry('a', '1.0.0'), 'node_modules/b': entry('b', '1.0.0') }), null, 2);
  const lines = keyLines(text);
  const at = (key) => text.split('\n').findIndex((l) => l.includes(`"${key}": {`)) + 1;
  assert.equal(lines.get('node_modules/a'), at('node_modules/a'));
  assert.equal(lines.get('node_modules/b'), at('node_modules/b'));
  assert.equal(lines.get(''), at(''));
});

test('readBounded refuses files over the size limit and drops a byte order mark; parseJson names the file', async () => {
  await withFiles({ 'small.json': String.fromCharCode(0xfeff) + '{"a":1}', 'big.json': '{"a":"' + 'x'.repeat(1500) + '"}' }, async (dir) => {
    assert.equal(await readBounded(join(dir, 'small.json')), '{"a":1}');
    await assert.rejects(readBounded(join(dir, 'big.json'), { ...LIMITS, maxFileBytes: 1000 }), /over the .* MB limit/);
    await assert.rejects(readBounded(dir), /not a file/);
    await writeFile(join(dir, 'bad.json'), '{');
    assert.throws(() => parseJson('{', 'bad.json'), /bad\.json: not valid JSON/);
  });
  assert.equal(LIMITS.maxFileBytes, 100 * 1024 * 1024);
  assert.equal(LIMITS.maxPackages, 200_000);
});
