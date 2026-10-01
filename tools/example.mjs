// Runs the README examples and checks that they report what the README shows.

import { main } from '../src/index.js';

async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) });
  process.stdout.write(out);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const clean = ['--lock', 'examples/orders-api/package-lock.json', '--package', 'examples/orders-api/package.json'];
const risky = ['--lock', 'examples/risky/package-lock.json', '--package', 'examples/risky/package.json'];

const pass = await run(clean);
expect('orders-api', pass, 0, [
  'lockfile-check: lock examples/orders-api/package-lock.json (lockfileVersion 3), package examples/orders-api/package.json',
  'packages: 15 locked (8 direct, 4 dev, 1 optional), 0 with install scripts, 1 link, 0 bundled',
  'findings: 0 error, 0 warning, 1 info',
  'INFO      missing-integrity    example-orders-shared is a link to the workspace packages/shared; workspace links have no integrity hash, as expected',
  'GATE: PASS (--fail-on error)'
], ['ERROR', 'WARNING', 'Install script']);

process.stdout.write('\n');
const fail = await run(risky);
expect('risky', fail, 1, [
  'lockfile-check: lock examples/risky/package-lock.json (lockfileVersion 3), package examples/risky/package.json',
  'packages: 16 locked (10 direct, 2 dev, 0 optional), 2 with install scripts, 0 links, 1 bundled',
  'findings: 6 error, 4 warning, 6 info',
  'Install script       Version  Path                              Allowed',
  'example-native-hash  5.1.2    node_modules/example-native-hash  no',
  'ERROR     non-registry-source  example-legacy-crypto@0.9.1 is downloaded from http://files.example.com/example-legacy-crypto-0.9.1.tgz',
  'ERROR     non-registry-source  example-pdf-render@1.3.0 comes from a git repository (git+ssh://git@github.com/example-org/example-pdf-render.git#',
  'ERROR     insecure-url         example-legacy-crypto@0.9.1 is resolved over an unencrypted connection',
  'ERROR     lock-out-of-sync     example-mailer: package.json (dependencies) asks for "^1.0.0", but it is not in the root of the lock file, and no version of it is locked.',
  'ERROR     lock-out-of-sync     example-orm: package.json (dependencies) asks for "^3.0.0", but the lock file was written for "^2.8.0", and the locked version 2.8.1 does not satisfy it.',
  'ERROR     missing-integrity    example-date-utils@2.29.4 has no integrity hash',
  'WARNING   registry-mismatch    example-private-auth@2.1.0 comes from https://***@npm.example.internal/example-private-auth/-/example-private-auth-2.1.0.tgz',
  'WARNING   weak-integrity       example-legacy-crypto@0.9.1 is checked with a SHA-1 hash only',
  'WARNING   install-script       example-image-tool@0.33.2 runs an install script',
  'WARNING   install-script       example-native-hash@5.1.2 runs an install script',
  'INFO      lock-out-of-sync     example-pdf-render: the range "github:example-org/example-pdf-render#v1.3.0" in package.json (dependencies) is a URL or protocol specifier (github:)',
  'INFO      duplicate-versions   example-debug-log is locked in 5 versions (2.6.9, 3.1.0, 3.2.7, 4.1.1, 4.3.4), more than --max-versions 3',
  'INFO      deprecated           example-request-lite@2.88.2 is deprecated',
  'INFO      license-missing      example-request-lite@2.88.2 has no license field',
  'INFO      bundled              example-image-tool@0.33.2 bundles 1 package inside its tarball (example-png-codec@1.6.0)',
  'GATE: FAIL - 6 errors'
], ['s3cr3t', 'deploy:']);

process.stdout.write('\n');
const configured = await run([...risky, '--config', 'examples/risky/lockfile-check.json']);
expect('risky with config', configured, 1, [
  'config examples/risky/lockfile-check.json',
  'findings: 6 error, 2 warning, 5 info',
  'example-native-hash  5.1.2    node_modules/example-native-hash  yes',
  'note: 1 finding left out by "ignore" rules in the config',
  'GATE: FAIL - 6 errors'
], ['registry-mismatch', 'install-script       example-native-hash', 'INFO      deprecated']);

let sarif = '';
const sarifCode = await main([...risky, '--format', 'sarif'], { out: (t) => { sarif += t; }, err: (t) => process.stderr.write(t) });
const log = JSON.parse(sarif);
if (sarifCode !== 1 || log.version !== '2.1.0' || log.runs[0].results.length !== 16 || log.runs[0].results.some((r) => r.locations[0].physicalLocation.artifactLocation.uri !== 'examples/risky/package-lock.json')) {
  problems.push('sarif: unexpected log');
}

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
