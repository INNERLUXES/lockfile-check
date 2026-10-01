import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs, main, toText, toMarkdown, toJson, toCsv, csvCell, mdCell, USAGE, VERSION, LIMITS } from '../src/index.js';
import { check, withFiles, entry, lockV3 } from './helpers.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const at = (p) => join(root, p).split('\\').join('/');
const quiet = { out: () => {}, err: () => {} };

async function capture(argv, limits) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, limits);
  return { code, out, err };
}

const clean = ['--lock', at('examples/orders-api/package-lock.json'), '--package', at('examples/orders-api/package.json')];
const risky = ['--lock', at('examples/risky/package-lock.json'), '--package', at('examples/risky/package.json')];

// A report with text that tries to break each format.
function hostile() {
  return check(lockV3({ 'node_modules/=cmd|x': entry('=cmd|x', '1.0.0', { deprecated: '@evil\nline | pipe, "quoted"' }) }));
}

test('parseArgs reads options and refuses bad input', () => {
  const o = parseArgs(['--lock', 'l.json', '--package', 'p.json', '--config', 'c.json', '--format', 'sarif', '--fail-on', 'warning', '--limit', '50', '--max-versions', '5']);
  assert.deepEqual([o.lock, o.package, o.config, o.format, o.failOn, o.limit, o.maxVersions], ['l.json', 'p.json', 'c.json', 'sarif', 'warning', 50, 5]);
  const d = parseArgs(['--lock', 'l.json']);
  assert.deepEqual([d.format, d.failOn, d.limit, d.maxVersions, d.package, d.config], ['text', 'error', 200, 3, null, null]);
  assert.throws(() => parseArgs([]), /--lock/);
  assert.throws(() => parseArgs(['--lock', 'l', '--format', 'xml']), /unknown format xml/);
  assert.throws(() => parseArgs(['--lock', 'l', '--format', 'toString']), /unknown format/);
  assert.throws(() => parseArgs(['--lock', 'l', '--fail-on', 'info']), /error or warning/);
  assert.throws(() => parseArgs(['--lock', 'l', '--limit', '0']), /--limit takes a whole number/);
  assert.throws(() => parseArgs(['--lock', 'l', '--max-versions', 'many']), /--max-versions takes a whole number/);
  assert.throws(() => parseArgs(['--lock', 'https://example.com/package-lock.json']), /never fetches a URL/);
  assert.throws(() => parseArgs(['--lock']), /needs a value/);
  assert.throws(() => parseArgs(['--lock', 'l', '--fix']), /unknown argument --fix/);
  assert.throws(() => parseArgs(['-']), /standard input/);
});

test('exit codes: 0 clean, 1 on errors or with --fail-on warning, 2 on usage or input errors', async () => {
  assert.equal(await main(clean, quiet), 0);
  assert.equal(await main([...clean, '--fail-on', 'warning'], quiet), 0);
  assert.equal(await main(risky, quiet), 1);
  assert.equal(await main(['--nope'], quiet), 2);
  assert.equal(await main(['--help'], quiet), 0);
  const v = await capture(['--version']);
  assert.equal(v.out.trim(), VERSION);
  const missing = await capture(['--lock', at('examples/none.json')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /no such file/);
  const notLock = await capture(['--lock', at('examples/orders-api/package.json')]);
  assert.equal(notLock.code, 2);
  assert.match(notLock.err, /lockfileVersion null is not supported/);
  const badConfig = await capture([...clean, '--config', at('examples/orders-api/package.json')]);
  assert.equal(badConfig.code, 2);
  assert.match(badConfig.err, /config: unknown key "name"/);
  const usage = await capture(['--format', 'json']);
  assert.equal(usage.code, 2);
  assert.ok(usage.err.includes(USAGE));
});

test('a warning-only lock passes by default and fails with --fail-on warning', async () => {
  await withFiles({ 'package-lock.json': lockV3({ 'node_modules/a': entry('a', '1.0.0', { hasInstallScript: true }) }) }, async (dir) => {
    const lock = ['--lock', join(dir, 'package-lock.json')];
    assert.equal(await main(lock, quiet), 0);
    assert.equal(await main([...lock, '--fail-on', 'warning'], quiet), 1);
  });
});

test('size limits: a lock file over the byte limit or with too many entries stops the run with exit code 2', async () => {
  const packages = {};
  for (let i = 0; i < 20; i += 1) packages[`node_modules/p${i}`] = entry(`p${i}`, '1.0.0');
  await withFiles({ 'package-lock.json': lockV3(packages) }, async (dir) => {
    const lock = ['--lock', join(dir, 'package-lock.json')];
    const big = await capture(lock, { ...LIMITS, maxFileBytes: 1000 });
    assert.equal(big.code, 2);
    assert.match(big.err, /over the .* MB limit/);
    const many = await capture(lock, { ...LIMITS, maxPackages: 10 });
    assert.equal(many.code, 2);
    assert.match(many.err, /20 package entries is over the limit of 10/);
    assert.equal((await capture(lock)).code, 0);
  });
});

test('the clean example: summary, one info line for the workspace link, and a passing gate', async () => {
  const { code, out } = await capture(clean);
  assert.equal(code, 0);
  assert.ok(out.startsWith(`lockfile-check: lock ${at('examples/orders-api/package-lock.json')} (lockfileVersion 3), package ${at('examples/orders-api/package.json')}\n`));
  assert.ok(out.includes('packages: 15 locked (8 direct, 4 dev, 1 optional), 0 with install scripts, 1 link, 0 bundled\n'));
  assert.ok(out.includes('findings: 0 error, 0 warning, 1 info\n'));
  assert.ok(out.endsWith('GATE: PASS (--fail-on error)\n'));
});

test('the risky example: the install script table, every check, errors first', async () => {
  const { code, out } = await capture(risky);
  assert.equal(code, 1);
  assert.ok(out.includes('findings: 6 error, 4 warning, 6 info\n'));
  assert.ok(out.includes('Install script       Version  Path                              Allowed\nexample-image-tool   0.33.2   node_modules/example-image-tool   no\n'));
  const order = [...out.matchAll(/^(ERROR|WARNING|INFO) +([a-z-]+)/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(order, [
    'ERROR non-registry-source', 'ERROR non-registry-source', 'ERROR insecure-url', 'ERROR lock-out-of-sync', 'ERROR lock-out-of-sync', 'ERROR missing-integrity',
    'WARNING registry-mismatch', 'WARNING weak-integrity', 'WARNING install-script', 'WARNING install-script',
    'INFO lock-out-of-sync', 'INFO lock-out-of-sync', 'INFO duplicate-versions', 'INFO deprecated', 'INFO license-missing', 'INFO bundled'
  ]);
  assert.ok(out.endsWith('GATE: FAIL - 6 errors\n'));
});

test('--limit shows the first findings and the total; --max-versions changes duplicate-versions', async () => {
  const { out } = await capture([...risky, '--limit', '2']);
  assert.ok(out.includes('findings: 6 error, 4 warning, 6 info (showing 2 of 16)\n'));
  assert.equal((out.match(/^ERROR /gm) || []).length, 2);
  assert.ok(out.includes('note: showing the first 2 findings of 16; raise --limit to see more'));
  const json = JSON.parse((await capture([...risky, '--format', 'json', '--max-versions', '5'])).out);
  assert.equal(json.byCheck['duplicate-versions'], 0);
});

test('the config example allows one install script, a second registry, and ignores one finding', async () => {
  const { code, out } = await capture([...risky, '--config', at('examples/risky/lockfile-check.json')]);
  assert.equal(code, 1);
  assert.ok(out.includes('findings: 6 error, 2 warning, 5 info\n'));
  assert.ok(out.includes('example-native-hash  5.1.2    node_modules/example-native-hash  yes'));
  assert.ok(!out.includes('registry-mismatch'));
});

test('JSON: the whole report, findings with package, version, path and line', async () => {
  const r = JSON.parse((await capture([...risky, '--format', 'json'])).out);
  assert.equal(r.tool, 'lockfile-check');
  assert.equal(r.lockfileVersion, 3);
  assert.equal(r.total, 16);
  assert.equal(r.findings.length, 16);
  assert.deepEqual(r.counts, { error: 6, warning: 4, info: 6 });
  const f = r.findings.find((x) => x.id === 'missing-integrity');
  assert.deepEqual([f.package, f.version, f.path], ['example-date-utils', '2.29.4', 'node_modules/example-date-utils']);
  assert.ok(f.line > 1);
  assert.equal(toJson(hostile()), JSON.stringify(hostile(), null, 2) + '\n');
});

test('Markdown escapes pipes, backslashes and line breaks in every cell', () => {
  assert.equal(mdCell('a|b\\c\nd'), 'a\\|b\\\\c d');
  const md = toMarkdown(hostile());
  assert.ok(md.startsWith('## lockfile-check: 0 error, 0 warning, 1 info\n'));
  assert.ok(md.includes('| info | deprecated | =cmd\\|x | =cmd\\|x@1.0.0 is deprecated: @evil line \\| pipe, "quoted" |'));
  for (const line of md.split('\n').filter((l) => l.startsWith('| info'))) assert.equal(line.split(/(?<!\\)\|/).length, 6);
});

test('CSV quotes as RFC 4180 says and defuses formulas', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(null), '');
  const csv = toCsv(hostile());
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'type,severity,id,package,version,path,line,message');
  assert.ok(lines[1].startsWith("finding,info,deprecated,'=cmd|x,1.0.0,node_modules/=cmd|x,"));
  assert.ok(csv.endsWith('\r\n'));
  const scripts = toCsv(check(lockV3({ 'node_modules/a': entry('a', '1.0.0', { hasInstallScript: true }) })));
  assert.ok(scripts.includes('\r\ninstall-script,,,a,1.0.0,node_modules/a,,not allowed\r\n'));
});

test('text: control characters in names cannot reach the terminal', () => {
  const esc = String.fromCharCode(27);
  const text = toText(check(lockV3({ [`node_modules/a${esc}[2J`]: entry(`a${esc}[2J`, '1.0.0', { deprecated: `x${esc}]0;title` }) })));
  assert.ok(!text.includes(esc));
  assert.ok(text.includes('a [2J@1.0.0'));
});

test('credentials in a resolved URL are masked in every format', async () => {
  const lock = lockV3({
    'node_modules/a': entry('a', '1.0.0', { resolved: 'https://ci-user:npm_s3cr3tT0ken@npm.example.internal/a/-/a-1.0.0.tgz' }),
    'node_modules/b': { version: '1.0.0', resolved: 'git+https://ghtok3n@example.com/u/b.git#abc', license: 'MIT' },
    'node_modules/c': { version: '1.0.0', resolved: 'http://user:pa55@files.example.com/c.tgz', integrity: 'sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=', license: 'MIT' }
  });
  await withFiles({ 'package-lock.json': lock }, async (dir) => {
    for (const format of ['text', 'markdown', 'json', 'csv', 'sarif']) {
      const { out } = await capture(['--lock', join(dir, 'package-lock.json'), '--format', format]);
      for (const secret of ['npm_s3cr3tT0ken', 'ci-user', 'ghtok3n', 'pa55']) assert.ok(!out.includes(secret), `${format} shows ${secret}`);
      assert.ok(out.includes('https://***@npm.example.internal/a/-/a-1.0.0.tgz'), format);
      assert.ok(out.includes('git+https://***@example.com/u/b.git'), format);
    }
  });
});
