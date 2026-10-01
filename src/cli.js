// Command line: lockfile-check --lock <package-lock.json> [--package <package.json>] [--config <file>] [options]

import { readFileSync } from 'node:fs';
import { readBounded, parseJson, parseLock, parsePackageJson, keyLines, LIMITS } from './load.js';
import { checkLock, parseConfig, FINDINGS, DEFAULTS } from './check.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';
import { toSarif } from './sarif.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv, sarif: (r) => toSarif(r, VERSION) };
const THRESHOLDS = ['error', 'warning'];

export const USAGE = `Usage: lockfile-check --lock <package-lock.json> [--package <package.json>] [options]

Checks an npm lock file for supply-chain risks before a Node.js back end is built or deployed.
It reads files only; it never runs npm, installs nothing and opens no connection.

Options:
  --lock <file>           package-lock.json or npm-shrinkwrap.json (lockfileVersion 1, 2 or 3)
  --package <file>        package.json, to compare the declared dependencies with the lock file
  --config <file>         allowed registries and git hosts, allowed install scripts, ignore rules (JSON)
  --format <name>         text, markdown, json, csv or sarif (default: text)
  --fail-on <level>       exit with 1 when a finding is at this level or above: error or warning
                          (default: error)
  --limit <n>             show at most n findings (default: ${DEFAULTS.limit}); the total is always shown
  --max-versions <n>      report a package locked in more than n versions (default: ${DEFAULTS.maxVersions})
  --help                  show this text
  --version               show the version

Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

function count(value, option, max) {
  if (!/^\d{1,7}$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error(`${option} takes a whole number from 1 to ${max.toLocaleString('en-US')}, not ${value}`);
  return Number(value);
}

export function parseArgs(argv) {
  const o = { lock: null, package: null, config: null, format: 'text', failOn: 'error', limit: DEFAULTS.limit, maxVersions: DEFAULTS.maxVersions, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--lock') o.lock = next();
    else if (a === '--package') o.package = next();
    else if (a === '--config') o.config = next();
    else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--limit') o.limit = count(next(), '--limit', 1_000_000);
    else if (a === '--max-versions') o.maxVersions = count(next(), '--max-versions', 10_000);
    else if (a === '-') throw new Error('reading from standard input is not supported; give a file');
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.help && !o.version) {
    if (o.lock === null) throw new Error('give the lock file with --lock');
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, markdown, json, csv or sarif)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
    for (const p of [o.lock, o.package, o.config]) {
      if (p !== null && /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) throw new Error('give local files; the tool never fetches a URL');
    }
  }
  return o;
}

// Reads the inputs and checks them. Throws on an input error.
async function run(o, limits) {
  const config = o.config === null ? parseConfig(null) : parseConfig(parseJson(await readBounded(o.config, limits), o.config));
  const pkg = o.package === null ? null : parsePackageJson(parseJson(await readBounded(o.package, limits), o.package), o.package);
  const source = await readBounded(o.lock, limits);
  const lock = parseLock(parseJson(source, o.lock), o.lock, limits);
  return checkLock(lock, {
    config, pkg, maxVersions: o.maxVersions, limit: o.limit, failOn: o.failOn, lines: keyLines(source),
    sources: { lock: o.lock, package: o.package, config: o.config }
  });
}

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = LIMITS) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`lockfile-check: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let report;
  try {
    report = await run(o, limits);
  } catch (error) {
    io.err(`lockfile-check: ${error.code === 'ENOENT' ? `${error.path}: no such file` : error.message}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}
