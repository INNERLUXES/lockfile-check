import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINDINGS, SEVERITIES, RANK, DEFAULT_REGISTRY, DEFAULTS, isFindingId, maskCredentials, safeText, meetsThreshold,
  parseConfig, classifySource, parseLock
} from '../src/index.js';
import { check, ids, find, entry, lockV3, reg, SRI } from './helpers.js';

const one = (name, extra) => lockV3({ [`node_modules/${name}`]: entry(name, '1.0.0', extra) });

test('every check has an id and known severities, and the list is complete', () => {
  assert.deepEqual(FINDINGS.map((f) => f.id), [
    'non-registry-source', 'insecure-url', 'lock-out-of-sync', 'missing-integrity', 'registry-mismatch', 'weak-integrity',
    'install-script', 'duplicate-versions', 'deprecated', 'license-missing', 'bundled'
  ]);
  for (const f of FINDINGS) for (const s of f.severity.split(' / ')) assert.ok(SEVERITIES.includes(s), f.id);
  assert.ok(isFindingId('bundled'));
  assert.ok(!isFindingId('nothing'));
  assert.ok(RANK.error < RANK.warning && RANK.warning < RANK.info);
  assert.ok(meetsThreshold('error', 'warning'));
  assert.ok(!meetsThreshold('warning', 'error'));
  assert.ok(!meetsThreshold('info', 'warning'));
  assert.equal(DEFAULT_REGISTRY, 'registry.npmjs.org');
  assert.deepEqual(DEFAULTS, { limit: 200, maxVersions: 3 });
});

test('a clean registry lock file has no findings', () => {
  const r = check(lockV3({ 'node_modules/a': entry('a', '1.2.0'), 'node_modules/@s/b': entry('@s/b', '2.0.0') }, { dependencies: { a: '^1.0.0', '@s/b': '~2.0.0' } }),
    { pkg: { dependencies: { a: '^1.0.0', '@s/b': '~2.0.0' } } });
  assert.deepEqual(r.findings, []);
  assert.equal(r.gate.pass, true);
  assert.equal(r.summary.packages, 2);
  assert.equal(r.summary.direct, 2);
});

test('classifySource tells registries, other registries, tarballs, git, local folders and workspaces apart', () => {
  const kind = (e, ctx) => classifySource({ link: false, local: false, ...e }, ctx).kind;
  assert.equal(kind({ resolved: reg('a', '1.0.0') }), 'registry');
  assert.equal(kind({ resolved: reg('a', '1.0.0', 'registry.yarnpkg.com') }), 'other-registry');
  assert.equal(kind({ resolved: reg('a', '1.0.0', 'registry.yarnpkg.com') }, { registries: ['registry.yarnpkg.com'] }), 'registry');
  assert.equal(kind({ resolved: 'https://cdn.example.com/files/a.tgz' }), 'tarball');
  assert.equal(kind({ resolved: 'https://codeload.github.com/u/r/tar.gz/abc' }), 'tarball');
  for (const g of ['git+ssh://git@github.com/u/r.git#abc', 'git+https://gitlab.com/u/r.git', 'github:u/r', 'git://example.com/r.git', 'git@bitbucket.org:u/r.git']) assert.equal(kind({ resolved: g }), 'git', g);
  assert.equal(classifySource({ resolved: 'github:u/r' }).host, 'github.com');
  assert.equal(classifySource({ resolved: 'git@bitbucket.org:u/r.git' }).host, 'bitbucket.org');
  assert.equal(kind({ resolved: 'file:../lib/a-1.0.0.tgz' }), 'local');
  assert.equal(kind({ resolved: 'packages/api', link: true }, { workspaces: ['packages/api'] }), 'workspace');
  assert.equal(kind({ resolved: '../other/api', link: true }, { workspaces: ['packages/api'] }), 'local');
  assert.equal(kind({ resolved: 'C:/code/api', link: true }), 'local');
  assert.equal(kind({ resolved: null }), 'unknown');
  assert.equal(classifySource({ resolved: 'http://registry.npmjs.org/a/-/a-1.0.0.tgz' }).insecure, true);
  assert.equal(classifySource({ resolved: 'git+http://example.com/r.git' }).insecure, true);
});

test('non-registry-source: git, plain tarball URLs and local files are errors; git hosts can be allowed', () => {
  const lock = lockV3({
    'node_modules/g': { version: '1.0.0', resolved: 'git+ssh://git@github.com/u/g.git#0123456789abcdef0123456789abcdef01234567', license: 'MIT' },
    'node_modules/t': { version: '1.0.0', resolved: 'https://cdn.example.com/t-1.0.0.tgz', integrity: SRI, license: 'MIT' },
    'node_modules/f': { version: '1.0.0', resolved: 'file:../vendor/f-1.0.0.tgz', integrity: SRI, license: 'MIT' }
  });
  const r = check(lock);
  assert.deepEqual(find(r, 'non-registry-source').map((f) => f.package), ['f', 'g', 't']);
  assert.ok(find(r, 'non-registry-source').every((f) => f.severity === 'error'));
  assert.match(find(r, 'non-registry-source')[1].message, /comes from a git repository/);
  assert.equal(find(r, 'missing-integrity').length, 0, 'git entries have no integrity hash by design');
  const allowed = check(lock, { config: { gitHosts: ['github.com'] } });
  assert.deepEqual(find(allowed, 'non-registry-source').map((f) => f.package), ['f', 't']);
});

test('link entries: a workspace link is info, a link outside the workspaces is a non-registry-source error', () => {
  const lock = lockV3({
    'node_modules/api': { resolved: 'packages/api', link: true },
    'node_modules/ext': { resolved: '../shared/ext', link: true },
    'packages/api': { name: 'api', version: '1.0.0' },
    'packages/api/node_modules/x': entry('x', '1.0.0')
  }, { workspaces: ['packages/*'], dependencies: { api: '^1.0.0', ext: 'file:../shared/ext' } });
  const r = check(lock, { pkg: { workspaces: ['packages/*'], dependencies: { api: '^1.0.0', ext: 'file:../shared/ext' } } });
  const info = find(r, 'missing-integrity');
  assert.deepEqual(info.map((f) => [f.package, f.severity]), [['api', 'info']]);
  assert.deepEqual(find(r, 'non-registry-source').map((f) => f.package), ['ext']);
  assert.match(find(r, 'non-registry-source')[0].message, /local folder \(\.\.\/shared\/ext\) outside the workspaces/);
  assert.equal(find(r, 'lock-out-of-sync').filter((f) => f.severity === 'error').length, 0, 'the workspace version satisfies ^1.0.0');
  assert.equal(r.summary.links, 2);
  assert.equal(r.summary.packages, 1);
  // Without package.json, folder entries of the lock file count as workspaces.
  assert.deepEqual(find(check(lock), 'missing-integrity').map((f) => f.package), ['api']);
  // A package.json without workspaces makes every link local.
  assert.deepEqual(find(check(lock, { pkg: { dependencies: { api: '^1.0.0', ext: 'file:../shared/ext' } } }), 'non-registry-source').map((f) => f.package), ['api', 'ext']);
});

test('insecure-url: http:// and git:// downloads are errors, even from the registry host', () => {
  const r = check(lockV3({
    'node_modules/a': entry('a', '1.0.0', { resolved: 'http://registry.npmjs.org/a/-/a-1.0.0.tgz' }),
    'node_modules/b': { version: '1.0.0', resolved: 'git://example.com/b.git#abc', license: 'MIT' }
  }), { config: { gitHosts: ['example.com'] } });
  assert.deepEqual(find(r, 'insecure-url').map((f) => [f.package, f.severity]), [['a', 'error'], ['b', 'error']]);
  assert.deepEqual(find(r, 'non-registry-source'), []);
});

test('registry-mismatch: a registry tarball from an unconfigured host is a warning, and the config can add the host', () => {
  const lock = one('a', { resolved: reg('a', '1.0.0', 'registry.yarnpkg.com') });
  const r = check(lock);
  assert.deepEqual(find(r, 'registry-mismatch').map((f) => f.severity), ['warning']);
  assert.match(find(r, 'registry-mismatch')[0].message, /a registry at registry\.yarnpkg\.com, not registry\.npmjs\.org/);
  assert.deepEqual(find(check(lock, { config: { registries: ['registry.npmjs.org', 'https://registry.yarnpkg.com/'] } }), 'registry-mismatch'), []);
  const only = check(one('a'), { config: { registries: ['npm.example.internal'] } });
  assert.deepEqual(find(only, 'registry-mismatch').length, 1, 'the default registry is replaced, not added to');
});

test('missing-integrity: an error for registry and URL downloads without a hash, skipped for bundled entries', () => {
  const r = check(lockV3({
    'node_modules/a': entry('a', '1.0.0', { integrity: undefined }),
    'node_modules/b': { version: '1.0.0', license: 'MIT' },
    'node_modules/c': { version: '1.0.0', integrity: SRI, license: 'MIT' },
    'node_modules/d': entry('d', '1.0.0'),
    'node_modules/d/node_modules/e': { version: '1.0.0', inBundle: true, license: 'MIT' }
  }));
  assert.deepEqual(find(r, 'missing-integrity').map((f) => [f.package, f.severity]), [['a', 'error'], ['b', 'error']]);
  assert.match(find(r, 'missing-integrity')[1].message, /no integrity hash and no resolved URL/);
});

test('weak-integrity: SHA-1 alone is a warning, SHA-1 next to sha512 is fine', () => {
  const r = check(lockV3({
    'node_modules/a': entry('a', '1.0.0', { integrity: 'sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=' }),
    'node_modules/b': entry('b', '1.0.0', { integrity: `sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA= ${SRI}` })
  }));
  assert.deepEqual(find(r, 'weak-integrity').map((f) => [f.package, f.severity]), [['a', 'warning']]);
});

test('install-script: a warning with the package and version, unless allowed by name or name@version', () => {
  const lock = lockV3({
    'node_modules/a': entry('a', '1.0.0', { hasInstallScript: true }),
    'node_modules/b': entry('b', '2.0.0', { hasInstallScript: true }),
    'node_modules/@s/c': entry('@s/c', '3.0.0', { hasInstallScript: true })
  });
  const r = check(lock);
  assert.deepEqual(find(r, 'install-script').map((f) => `${f.package}@${f.version}`), ['@s/c@3.0.0', 'a@1.0.0', 'b@2.0.0']);
  assert.ok(find(r, 'install-script').every((f) => f.severity === 'warning'));
  assert.deepEqual(r.installScripts.map((s) => [s.package, s.allowed]), [['a', false], ['b', false], ['@s/c', false]]);
  const allowed = check(lock, { config: { allowInstallScripts: ['a', 'b@9.9.9', '@s/c@3.0.0'] } });
  assert.deepEqual(find(allowed, 'install-script').map((f) => f.package), ['b']);
  assert.deepEqual(allowed.installScripts.map((s) => s.allowed), [true, false, true]);
  assert.equal(allowed.summary.installScripts, 3);
});

test('lock-out-of-sync: missing dependencies, a different root range and a locked version outside the range are errors', () => {
  const lock = lockV3({
    'node_modules/a': entry('a', '1.5.0'),
    'node_modules/b': entry('b', '2.0.0'),
    'node_modules/c': entry('c', '3.0.0'),
    'node_modules/extra': entry('extra', '1.0.0')
  }, { dependencies: { a: '^1.0.0', b: '^2.0.0', extra: '^1.0.0' }, devDependencies: { c: '^3.0.0' } });
  const pkg = { dependencies: { a: '^1.0.0', b: '^3.0.0', missing: '^1.0.0' }, devDependencies: { c: '^3.1.0' } };
  const r = check(lock, { pkg });
  const errors = find(r, 'lock-out-of-sync').filter((f) => f.severity === 'error');
  assert.deepEqual(errors.map((f) => f.package).sort(), ['b', 'c', 'extra', 'missing']);
  const by = Object.fromEntries(errors.map((f) => [f.package, f.message]));
  assert.match(by.b, /asks for "\^3\.0\.0", but the lock file was written for "\^2\.0\.0", and the locked version 2\.0\.0 does not satisfy it/);
  assert.match(by.c, /\(devDependencies\) asks for "\^3\.1\.0"/);
  assert.match(by.missing, /not in the root of the lock file, and no version of it is locked/);
  assert.match(by.extra, /in the root of the lock file but not in package\.json/);
});

test('lock-out-of-sync: ranges the matcher cannot read are info, never an error', () => {
  const lock = lockV3({
    'node_modules/a': entry('a', '1.0.0'),
    'node_modules/g': { version: '1.0.0', resolved: 'git+ssh://git@github.com/u/g.git#abc', license: 'MIT' }
  }, { dependencies: { a: 'latest', g: 'github:u/g' } });
  const r = check(lock, { pkg: { dependencies: { a: 'latest', g: 'github:u/g' } }, config: { gitHosts: ['github.com'] } });
  assert.deepEqual(find(r, 'lock-out-of-sync').map((f) => [f.package, f.severity]), [['a', 'info'], ['g', 'info']]);
  assert.match(find(r, 'lock-out-of-sync')[0].message, /the tag "latest", which only the registry can resolve/);
  assert.equal(r.gate.pass, true);
});

test('lock-out-of-sync on lockfileVersion 1 compares package.json with the top-level entries', () => {
  const r = check({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', resolved: reg('a', '1.0.0'), integrity: SRI } } },
    { pkg: { dependencies: { a: '^2.0.0', b: '^1.0.0' } } });
  assert.deepEqual(find(r, 'lock-out-of-sync').map((f) => f.package).sort(), ['a', 'b']);
  assert.match(find(r, 'lock-out-of-sync').find((f) => f.package === 'a').message, /the locked version 1\.0\.0 does not satisfy it/);
  assert.match(find(r, 'lock-out-of-sync').find((f) => f.package === 'b').message, /no version of it is locked/);
  assert.equal(r.summary.direct, 2);
  assert.ok(r.notes.some((n) => /lockfileVersion 1/.test(n)));
});

test('without --package, lock-out-of-sync is skipped and a note says so', () => {
  const r = check(one('a'));
  assert.ok(r.notes.some((n) => /no --package given/.test(n)));
  assert.equal(find(r, 'lock-out-of-sync').length, 0);
});

test('duplicate-versions: more than --max-versions versions of one name, sorted by version', () => {
  const packages = { 'node_modules/d': entry('d', '10.0.0') };
  ['1.0.0', '2.0.0', '9.0.0'].forEach((v, i) => { packages[`node_modules/p${i}/node_modules/d`] = entry('d', v); packages[`node_modules/p${i}`] = entry(`p${i}`, '1.0.0'); });
  const r = check(lockV3(packages));
  assert.deepEqual(find(r, 'duplicate-versions').map((f) => [f.package, f.severity]), [['d', 'info']]);
  assert.match(find(r, 'duplicate-versions')[0].message, /locked in 4 versions \(1\.0\.0, 2\.0\.0, 9\.0\.0, 10\.0\.0\), more than --max-versions 3/);
  assert.equal(find(check(lockV3(packages), { maxVersions: 4 }), 'duplicate-versions').length, 0);
});

test('deprecated and license-missing are info; license-missing stays silent when the lock records no licenses', () => {
  const r = check(lockV3({
    'node_modules/a': entry('a', '1.0.0', { deprecated: 'use b' }),
    'node_modules/b': entry('b', '1.0.0', { license: undefined })
  }));
  assert.deepEqual(find(r, 'deprecated').map((f) => [f.package, f.severity]), [['a', 'info']]);
  assert.match(find(r, 'deprecated')[0].message, /is deprecated: use b/);
  assert.deepEqual(find(r, 'license-missing').map((f) => f.package), ['b']);
  const none = check(lockV3({ 'node_modules/a': { version: '1.0.0', resolved: reg('a', '1.0.0'), integrity: SRI } }));
  assert.equal(parseLock(lockV3({ 'node_modules/a': { version: '1.0.0' } })).hasLicenses, false);
  assert.deepEqual(ids(none), []);
});

test('bundled: one info finding per package that bundles others', () => {
  const r = check(lockV3({
    'node_modules/a': entry('a', '1.0.0'),
    'node_modules/a/node_modules/x': { version: '1.0.0', inBundle: true, license: 'MIT' },
    'node_modules/a/node_modules/y': { version: '2.0.0', inBundle: true, license: 'MIT' }
  }));
  assert.deepEqual(find(r, 'bundled').map((f) => [f.package, f.severity]), [['a', 'info']]);
  assert.match(find(r, 'bundled')[0].message, /a@1\.0\.0 bundles 2 packages inside its tarball \(x@1\.0\.0, y@2\.0\.0\)/);
  assert.equal(r.summary.bundled, 2);
});

test('summary counts packages, direct, dev, optional and install scripts', () => {
  const r = check(lockV3({
    'node_modules/a': entry('a', '1.0.0'),
    'node_modules/b': entry('b', '1.0.0', { dev: true }),
    'node_modules/c': entry('c', '1.0.0', { optional: true, hasInstallScript: true }),
    'node_modules/d': entry('d', '1.0.0', { devOptional: true })
  }, { dependencies: { a: '1.0.0' }, devDependencies: { b: '1.0.0' }, optionalDependencies: { c: '1.0.0' } }), { config: { allowInstallScripts: ['c'] } });
  assert.deepEqual({ ...r.summary, registries: undefined }, { packages: 4, direct: 3, dev: 2, optional: 2, installScripts: 1, links: 0, bundled: 0, registries: undefined });
});

test('config: strict keys, host and name lists, and ignore rules by check, package or both', () => {
  assert.deepEqual(parseConfig(null), { registries: ['registry.npmjs.org'], gitHosts: [], allowInstallScripts: [], ignore: [] });
  assert.deepEqual(parseConfig({ registries: ['HTTPS://Npm.Example.Internal/'] }).registries, ['npm.example.internal']);
  assert.throws(() => parseConfig({ registry: ['x'] }), /unknown key "registry"/);
  assert.throws(() => parseConfig({ registries: [] }), /is empty/);
  assert.throws(() => parseConfig({ registries: ['not a host'] }), /not a host name/);
  assert.throws(() => parseConfig({ gitHosts: 'github.com' }), /must be a list/);
  assert.throws(() => parseConfig({ allowInstallScripts: [''] }), /list of package names/);
  assert.throws(() => parseConfig({ ignore: [{}] }), /needs a "check", a "package" or both/);
  assert.throws(() => parseConfig({ ignore: [{ check: 'nope' }] }), /unknown check "nope"/);
  assert.throws(() => parseConfig({ ignore: [{ check: 'deprecated', pkg: 'x' }] }), /unknown key "pkg" in ignore\[0\]/);
  assert.throws(() => parseConfig([]), /expected an object/);
  const lock = lockV3({ 'node_modules/a': entry('a', '1.0.0', { deprecated: 'old', hasInstallScript: true }), 'node_modules/b': entry('b', '1.0.0', { deprecated: 'old' }) });
  const r = check(lock, { config: { ignore: [{ check: 'deprecated', package: 'a' }, { package: 'b@1.0.0', reason: 'checked by hand' }] } });
  assert.deepEqual(r.findings.map((f) => `${f.id}:${f.package}`), ['install-script:a']);
  assert.equal(r.ignored, 2);
  assert.ok(r.notes.some((n) => /2 findings left out by "ignore" rules/.test(n)));
});

test('findings are sorted errors first, limited by --limit, and the total is kept', () => {
  const packages = {};
  for (let i = 0; i < 6; i += 1) packages[`node_modules/p${i}`] = entry(`p${i}`, '1.0.0', { deprecated: 'old', integrity: i === 5 ? undefined : SRI });
  const r = check(lockV3(packages), { limit: 3 });
  assert.equal(r.total, 7);
  assert.equal(r.findings.length, 3);
  assert.equal(r.findings[0].id, 'missing-integrity');
  assert.deepEqual(r.counts, { error: 1, warning: 0, info: 6 });
  assert.ok(r.notes.some((n) => /showing the first 3 findings of 7/.test(n)));
  assert.equal(r.gate.pass, false);
  assert.equal(r.gate.reason, '1 error');
});

test('the gate: errors fail by default, warnings with --fail-on warning, info never', () => {
  const warn = one('a', { hasInstallScript: true });
  assert.equal(check(warn).gate.pass, true);
  assert.equal(check(warn, { failOn: 'warning' }).gate.pass, false);
  assert.equal(check(warn, { failOn: 'warning' }).gate.reason, '1 warning');
  assert.equal(check(one('a', { deprecated: 'x' }), { failOn: 'warning' }).gate.pass, true);
});

test('credentials in URLs are masked, the git user is kept, and control characters are removed', () => {
  assert.equal(maskCredentials('https://user:t0ken@npm.example.internal/a/-/a-1.0.0.tgz'), 'https://***@npm.example.internal/a/-/a-1.0.0.tgz');
  assert.equal(maskCredentials('git+https://ghp-token@github.com/u/r.git'), 'git+https://***@github.com/u/r.git');
  assert.equal(maskCredentials('git+ssh://git@github.com/u/r.git'), 'git+ssh://git@github.com/u/r.git');
  const esc = String.fromCharCode(27);
  const rtl = String.fromCharCode(0x202e);
  assert.equal(safeText(`a${esc}[31mb${rtl}c\nd`), 'a [31mb c d');
  assert.equal(safeText('x'.repeat(400)).length, 300);
  const r = check(one('a', { resolved: 'https://deploy:s3cr3t@npm.example.internal/a/-/a-1.0.0.tgz' }));
  assert.ok(!JSON.stringify(r).includes('s3cr3t'));
  assert.match(find(r, 'registry-mismatch')[0].message, /https:\/\/\*\*\*@npm\.example\.internal/);
});
