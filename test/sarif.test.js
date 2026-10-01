import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SARIF_VERSION, SARIF_SCHEMA, sarifUri, toSarif, FINDINGS } from '../src/index.js';
import { check, entry, lockV3 } from './helpers.js';

const sources = { lock: 'services/api/package-lock.json' };

test('SARIF log: version 2.1.0, one rule per check, results that point at the lock file and the package path', () => {
  const lock = lockV3({
    'node_modules/a': entry('a', '1.0.0', { integrity: undefined }),
    'node_modules/b': entry('b', '1.0.0', { hasInstallScript: true }),
    'node_modules/c': entry('c', '1.0.0', { deprecated: 'old' })
  });
  const lines = new Map([['node_modules/a', 12], ['node_modules/b', 20], ['node_modules/c', 30]]);
  const log = JSON.parse(toSarif(check(lock, { lines, sources }), '1.2.3'));
  assert.equal(log.version, SARIF_VERSION);
  assert.equal(log.version, '2.1.0');
  assert.equal(log.$schema, SARIF_SCHEMA);
  assert.equal(log.runs.length, 1);
  const driver = log.runs[0].tool.driver;
  assert.equal(driver.name, 'lockfile-check');
  assert.equal(driver.version, '1.2.3');
  assert.deepEqual(driver.rules.map((r) => r.id), FINDINGS.map((f) => f.id));
  assert.equal(driver.rules.find((r) => r.id === 'bundled').defaultConfiguration.level, 'note');
  assert.equal(driver.rules.find((r) => r.id === 'install-script').defaultConfiguration.level, 'warning');
  const results = log.runs[0].results;
  assert.deepEqual(results.map((r) => [r.ruleId, r.level]), [['missing-integrity', 'error'], ['install-script', 'warning'], ['deprecated', 'note']]);
  for (const r of results) {
    assert.equal(driver.rules[r.ruleIndex].id, r.ruleId);
    assert.equal(typeof r.message.text, 'string');
    assert.equal(r.locations[0].physicalLocation.artifactLocation.uri, 'services/api/package-lock.json');
    assert.ok(r.partialFingerprints.lockfileCheck.startsWith(r.ruleId));
  }
  assert.deepEqual(results.map((r) => r.locations[0].physicalLocation.region.startLine), [12, 20, 30]);
  assert.deepEqual(results[0].locations[0].logicalLocations, [{ name: 'node_modules/a', kind: 'module' }]);
});

test('SARIF results follow --limit, and an empty report gives an empty result list', () => {
  const packages = {};
  for (let i = 0; i < 5; i += 1) packages[`node_modules/p${i}`] = entry(`p${i}`, '1.0.0', { deprecated: 'old' });
  assert.equal(JSON.parse(toSarif(check(lockV3(packages), { limit: 2, sources }))).runs[0].results.length, 2);
  assert.deepEqual(JSON.parse(toSarif(check(lockV3({}), { sources }))).runs[0].results, []);
});

test('sarifUri: relative paths stay relative with forward slashes, absolute paths become file URIs', () => {
  assert.equal(sarifUri('./package-lock.json'), 'package-lock.json');
  assert.equal(sarifUri('apps\\api\\package-lock.json'), 'apps/api/package-lock.json');
  assert.equal(sarifUri('my app/package-lock.json'), 'my%20app/package-lock.json');
  assert.equal(sarifUri('C:\\work\\package-lock.json'), 'file:///C:/work/package-lock.json');
  assert.equal(sarifUri('/srv/app/package-lock.json'), 'file:///srv/app/package-lock.json');
  assert.equal(sarifUri(null), 'package-lock.json');
});
