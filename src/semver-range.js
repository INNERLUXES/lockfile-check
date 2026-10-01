// A small matcher for the version ranges npm writes in package.json. It covers the common forms:
// exact versions, ^, ~, >, >=, <, <=, =, x and * wildcards and partial versions, hyphen ranges, ranges joined by
// spaces (and) and by || (or). Anything else (dist-tags, URLs, git, file:, npm: aliases, workspace:) is reported
// as unsupported rather than guessed. docs/method.md gives the rules, including the one for prereleases.

const MAX_RANGE = 256;
const NUM = '0|[1-9]\\d{0,15}';
const PRE = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*';
const VERSION = new RegExp(`^v?(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${PRE}))?(?:\\+${PRE})?$`);
const PARTIAL = new RegExp(`^v?(${NUM}|[xX*])(?:\\.(${NUM}|[xX*])(?:\\.(${NUM}|[xX*])(?:-(${PRE}))?(?:\\+${PRE})?)?)?$`);

// A full version ("1.2.3", "1.2.3-beta.1", "v1.2.3+build") as { major, minor, patch, pre }, or null.
export function parseVersion(value) {
  if (typeof value !== 'string' || value.length > MAX_RANGE) return null;
  const m = VERSION.exec(value.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn) {
      const d = Number(a[i]) - Number(b[i]);
      if (d) return Math.sign(d);
    } else if (an) return -1;
    else if (bn) return 1;
    else if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// Semantic Versioning precedence: -1, 0 or 1. Build metadata is ignored.
export function compareVersions(a, b) {
  return Math.sign(a.major - b.major) || Math.sign(a.minor - b.minor) || Math.sign(a.patch - b.patch) || comparePre(a.pre, b.pre);
}

const v = (major, minor, patch, pre = []) => ({ major, minor, patch, pre });
const isX = (p) => p === undefined || p === 'x' || p === 'X' || p === '*';

// A partial version: the numbers given, with wildcards and missing parts as null.
function partial(text) {
  const m = PARTIAL.exec(text);
  if (!m) return null;
  const major = isX(m[1]) ? null : Number(m[1]);
  const minor = major === null || isX(m[2]) ? null : Number(m[2]);
  const patch = minor === null || isX(m[3]) ? null : Number(m[3]);
  return { major, minor, patch, pre: patch !== null && m[4] ? m[4].split('.') : [] };
}

const ge = (ver) => ({ op: '>=', ver });
const lt = (ver) => ({ op: '<', ver });

// One comparator ("^1.2", ">=1.0.0", "1.x") as a list of { op, ver } that must all hold. An empty list matches every version.
function comparator(token) {
  const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
  const op = m[1] || '';
  const p = partial(m[2]);
  if (!p) return null;
  const { major, minor, patch, pre } = p;
  if (op === '^') {
    if (major === null) return [];
    const from = v(major, minor ?? 0, patch ?? 0, pre);
    if (major > 0 || minor === null) return [ge(from), lt(v(major + 1, 0, 0, ['0']))];
    if (minor > 0 || patch === null) return [ge(from), lt(v(0, minor + 1, 0, ['0']))];
    return [ge(from), lt(v(0, 0, patch + 1, ['0']))];
  }
  if (op === '~' || op === '~>') {
    if (major === null) return [];
    const from = v(major, minor ?? 0, patch ?? 0, pre);
    if (minor === null) return [ge(from), lt(v(major + 1, 0, 0, ['0']))];
    return [ge(from), lt(v(major, minor + 1, 0, ['0']))];
  }
  if (op === '' || op === '=') {
    if (major === null) return [];
    if (minor === null) return [ge(v(major, 0, 0)), lt(v(major + 1, 0, 0, ['0']))];
    if (patch === null) return [ge(v(major, minor, 0)), lt(v(major, minor + 1, 0, ['0']))];
    return [{ op: '=', ver: v(major, minor, patch, pre) }];
  }
  if (major === null) return op === '<' || op === '>' ? [{ op: 'none' }] : [];
  if (op === '>=') return [ge(v(major, minor ?? 0, patch ?? 0, pre))];
  if (op === '<') return [lt(v(major, minor ?? 0, patch ?? 0, patch === null ? ['0'] : pre))];
  if (op === '>') {
    if (minor === null) return [ge(v(major + 1, 0, 0))];
    if (patch === null) return [ge(v(major, minor + 1, 0))];
    return [{ op: '>', ver: v(major, minor, patch, pre) }];
  }
  // <=
  if (minor === null) return [lt(v(major + 1, 0, 0, ['0']))];
  if (patch === null) return [lt(v(major, minor + 1, 0, ['0']))];
  return [{ op: '<=', ver: v(major, minor, patch, pre) }];
}

// One set of a range (the part between two ||): a hyphen range or comparators separated by spaces.
function rangeSet(text) {
  const t = text.trim();
  if (t === '') return [];
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(t);
  if (hyphen) {
    const a = partial(hyphen[1]);
    const b = partial(hyphen[2]);
    if (!a || !b) return null;
    const out = [];
    if (a.major !== null) out.push(ge(v(a.major, a.minor ?? 0, a.patch ?? 0, a.pre)));
    if (b.major !== null) {
      if (b.minor === null) out.push(lt(v(b.major + 1, 0, 0, ['0'])));
      else if (b.patch === null) out.push(lt(v(b.major, b.minor + 1, 0, ['0'])));
      else out.push({ op: '<=', ver: v(b.major, b.minor, b.patch, b.pre) });
    }
    return out;
  }
  // "> 1.2" is written with a space sometimes; join an operator with the version after it.
  const tokens = t.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/);
  const out = [];
  for (const token of tokens) {
    const c = comparator(token);
    if (c === null) return null;
    out.push(...c);
  }
  return out;
}

// A range from package.json as { ok: true, sets } or { ok: false, reason }.
export function parseRange(range) {
  if (typeof range !== 'string') return { ok: false, reason: 'not text' };
  if (range.length > MAX_RANGE) return { ok: false, reason: `longer than ${MAX_RANGE} characters` };
  const r = range.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return { ok: false, reason: `a URL or protocol specifier (${r.slice(0, r.indexOf(':') + 1)}), not a version range` };
  if (/^[^\s@/]+\/[^\s]+$/.test(r) && !/^[\d^~<>=*xX|. -]/.test(r)) return { ok: false, reason: 'a GitHub shorthand, not a version range' };
  if (/^[a-z][a-z0-9._-]*$/i.test(r) && !/^[xX]$/.test(r) && !/^v\d/.test(r)) return { ok: false, reason: `the tag "${r}", which only the registry can resolve` };
  const sets = [];
  for (const part of r.split('||')) {
    const s = rangeSet(part);
    if (s === null) return { ok: false, reason: 'a form this matcher does not read' };
    sets.push(s);
  }
  return { ok: true, sets };
}

function test(ver, c) {
  if (c.op === 'none') return false;
  const d = compareVersions(ver, c.ver);
  if (c.op === '>=') return d >= 0;
  if (c.op === '>') return d > 0;
  if (c.op === '<') return d < 0;
  if (c.op === '<=') return d <= 0;
  return d === 0;
}

// Prerelease rule (as npm): a version with a prerelease tag matches a set only if every comparator holds and one
// comparator of that set names the same major.minor.patch with a prerelease tag of its own. So 1.3.0-beta.1 matches
// ">=1.3.0-beta.0" but not "^1.2.0"; bounds the matcher adds itself (such as the "<2.0.0-0" of "^1.2.0") never let one in.
function setMatches(ver, set) {
  for (const c of set) if (!test(ver, c)) return false;
  if (!ver.pre.length) return true;
  return set.some((c) => c.ver && c.ver.pre.length && !(c.ver.pre.length === 1 && c.ver.pre[0] === '0' && c.op === '<')
    && c.ver.major === ver.major && c.ver.minor === ver.minor && c.ver.patch === ver.patch);
}

// Does a version satisfy a range? { ok: true, match } or { ok: false, reason } when the range or version cannot be read.
export function satisfies(version, range) {
  const ver = parseVersion(version);
  if (!ver) return { ok: false, reason: `"${String(version).slice(0, 60)}" is not a version` };
  const r = parseRange(range);
  if (!r.ok) return r;
  return { ok: true, match: r.sets.some((s) => setMatches(ver, s)) };
}
