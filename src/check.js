// Checks the entries of an npm lock file for supply-chain risks.
// docs/method.md gives the reason behind every check.

import { satisfies, parseVersion, compareVersions } from './semver-range.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };
export const DEFAULT_REGISTRY = 'registry.npmjs.org';
export const DEFAULTS = { limit: 200, maxVersions: 3 };

export const FINDINGS = [
  { id: 'non-registry-source', severity: 'error', what: 'A package comes from git, a plain tarball URL, or a local folder or file outside the workspaces, not from a registry' },
  { id: 'insecure-url', severity: 'error', what: 'A package is resolved over plain http:// (or git://), which anyone on the network path can change' },
  { id: 'lock-out-of-sync', severity: 'error / info', what: 'package.json and the lock file disagree: a dependency is missing, or the locked version does not satisfy the range; info when a range cannot be read' },
  { id: 'missing-integrity', severity: 'error / info', what: 'A package downloaded from a registry or URL has no integrity hash; info for workspace links, which never have one' },
  { id: 'registry-mismatch', severity: 'warning', what: 'A registry tarball comes from a host that is not one of the configured registries' },
  { id: 'weak-integrity', severity: 'warning', what: 'The only integrity hash of a package is SHA-1' },
  { id: 'install-script', severity: 'warning', what: 'A package runs a script when it is installed, and is not on the allow list' },
  { id: 'duplicate-versions', severity: 'info', what: 'The same package is locked in more versions than --max-versions' },
  { id: 'deprecated', severity: 'info', what: 'A package carries a deprecation message in the lock file' },
  { id: 'license-missing', severity: 'info', what: 'A package has no license field while the lock file records licenses for others' },
  { id: 'bundled', severity: 'info', what: 'A package ships bundled dependencies, which have no integrity hash of their own' }
];

const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));

export function isFindingId(id) {
  return Object.hasOwn(ORDER, id);
}

// User and password in a URL ("https://user:token@host/...") are replaced by ***, so a token in a lock file never
// reaches a report. The plain user name "git" of git+ssh addresses is kept.
export function maskCredentials(value) {
  return String(value).replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, (all, scheme, user) => (user === 'git' ? all : `${scheme}***@`));
}

// Text from the input: credentials masked, control and direction characters removed and length capped.
export function safeText(value, max = 300) {
  const s = maskCredentials(String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, ' '));
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function quoteList(items, max = 5) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${(items.length - max).toLocaleString('en-US')} more` : shown;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

function hostList(value, key) {
  if (!Array.isArray(value)) throw new Error(`config: "${key}" must be a list of host names`);
  return value.map((h) => {
    const s = typeof h === 'string' ? h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '') : '';
    if (!HOST.test(s)) throw new Error(`config: "${key}" holds ${safeText(JSON.stringify(h), 80)}, which is not a host name`);
    return s;
  });
}

function nameList(value, key) {
  if (!Array.isArray(value) || value.some((n) => typeof n !== 'string' || n.trim() === '')) throw new Error(`config: "${key}" must be a list of package names`);
  return value.map((n) => n.trim());
}

// The config file, checked. Unknown keys stop the run, so a typo cannot switch an allow list off without notice.
export function parseConfig(config) {
  const out = { registries: [DEFAULT_REGISTRY], gitHosts: [], allowInstallScripts: [], ignore: [] };
  if (config === null || config === undefined) return out;
  if (!isObject(config)) throw new Error('config: expected an object');
  const known = ['registries', 'gitHosts', 'allowInstallScripts', 'ignore'];
  for (const k of Object.keys(config)) if (!known.includes(k)) throw new Error(`config: unknown key "${safeText(k, 60)}" (expected ${known.join(', ')})`);
  if (config.registries !== undefined) {
    out.registries = hostList(config.registries, 'registries');
    if (!out.registries.length) throw new Error('config: "registries" is empty; name at least one registry host');
  }
  if (config.gitHosts !== undefined) out.gitHosts = hostList(config.gitHosts, 'gitHosts');
  if (config.allowInstallScripts !== undefined) out.allowInstallScripts = nameList(config.allowInstallScripts, 'allowInstallScripts');
  if (config.ignore !== undefined) {
    if (!Array.isArray(config.ignore)) throw new Error('config: "ignore" must be a list of { "check", "package" } objects');
    out.ignore = config.ignore.map((rule, i) => {
      if (!isObject(rule)) throw new Error(`config: ignore[${i}] must be an object`);
      for (const k of Object.keys(rule)) if (!['check', 'package', 'reason'].includes(k)) throw new Error(`config: unknown key "${safeText(k, 60)}" in ignore[${i}] (expected check, package, reason)`);
      if (rule.check === undefined && rule.package === undefined) throw new Error(`config: ignore[${i}] needs a "check", a "package" or both`);
      if (rule.check !== undefined && !isFindingId(rule.check)) throw new Error(`config: ignore[${i}] names the unknown check ${safeText(JSON.stringify(rule.check), 60)}`);
      if (rule.package !== undefined && (typeof rule.package !== 'string' || !rule.package.trim())) throw new Error(`config: ignore[${i}].package must be a package name`);
      return { check: rule.check ?? null, package: rule.package === undefined ? null : rule.package.trim() };
    });
  }
  return out;
}

// "name" matches every version, "name@version" one version. A scoped name keeps its leading @.
function nameMatches(pattern, name, version) {
  if (pattern === name) return true;
  const at = pattern.lastIndexOf('@');
  return at > 0 && pattern.slice(0, at) === name && pattern.slice(at + 1) === version;
}

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function gitHost(resolved) {
  const short = /^(github|gitlab|bitbucket|gist):/i.exec(resolved);
  if (short) return { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org', gist: 'gist.github.com' }[short[1].toLowerCase()];
  const scp = /^[^@\s/]+@([^:\s/]+):/.exec(resolved);
  if (scp) return scp[1].toLowerCase();
  try {
    return new URL(resolved.replace(/^git\+/i, '')).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Where an entry comes from: registry, other-registry, tarball, git, local, workspace or unknown (no "resolved").
export function classifySource(entry, context = {}) {
  const registries = context.registries ?? [DEFAULT_REGISTRY];
  const workspaces = context.workspaces ?? [];
  const r = entry.resolved;
  if (entry.link) {
    const target = (r ?? '').replace(/\\/g, '/');
    const inside = target !== '' && !/^(?:\.\.(?:\/|$)|\/|[a-z]:|[a-z][a-z0-9+.-]*:)/i.test(target);
    return { kind: inside && workspaces.includes(target) ? 'workspace' : 'local', host: null, insecure: false };
  }
  if (r === null) return { kind: entry.local ? 'local' : 'unknown', host: null, insecure: false };
  if (/^file:/i.test(r) || entry.local) return { kind: 'local', host: null, insecure: false };
  if (/^(?:git(?:\+[a-z]+)?:|github:|gitlab:|bitbucket:|gist:|ssh:\/\/)/i.test(r) || /^[^@\s/:]+@[^:\s/]+:/.test(r)) {
    return { kind: 'git', host: gitHost(r), insecure: /^(?:git:|git\+http:)/i.test(r) };
  }
  if (/^https?:\/\//i.test(r)) {
    let url;
    try {
      url = new URL(r);
    } catch {
      return { kind: 'tarball', host: null, insecure: /^http:/i.test(r) };
    }
    const host = url.port ? `${url.hostname}:${url.port}`.toLowerCase() : url.hostname.toLowerCase();
    const insecure = url.protocol === 'http:';
    if (registries.includes(host) || registries.includes(url.hostname.toLowerCase())) return { kind: 'registry', host, insecure };
    if (/\/-\/[^/]+\.tgz$/i.test(url.pathname)) return { kind: 'other-registry', host, insecure };
    return { kind: 'tarball', host, insecure };
  }
  return { kind: 'tarball', host: null, insecure: false };
}

// Checks a parsed lock file (from parseLock), and package.json (from parsePackageJson) when given.
//   options  config (from parseConfig), pkg, maxVersions, limit, failOn, lines (from keyLines), notes, sources
export function checkLock(lock, options = {}) {
  const o = { config: parseConfig(null), pkg: null, maxVersions: DEFAULTS.maxVersions, limit: DEFAULTS.limit, failOn: 'error', lines: null, notes: [], sources: null, ...options };
  const cfg = o.config;
  const show = (t) => safeText(t, 300);
  const all = [];
  const notes = [...(lock.notes || []), ...o.notes];
  const lineOf = (path) => (o.lines && (o.lines.get(path) ?? (lock.lockfileVersion === 1 ? o.lines.get(path.slice(path.lastIndexOf('node_modules/') + 13)) : undefined))) || 1;
  const add = (id, severity, entry, message) => all.push({
    id, severity,
    package: entry && entry.name !== undefined ? entry.name : null,
    version: entry && entry.version !== undefined ? entry.version : null,
    path: entry && entry.path !== undefined ? entry.path : null,
    line: entry && entry.path !== undefined && entry.path !== null ? lineOf(entry.path) : (o.lines && o.lines.get('')) || 1,
    message: safeText(message, 1200)
  });
  const label = (p) => `${show(p.name)}@${p.version === null ? '?' : show(p.version)}`;
  const where = (p) => (p.path === `node_modules/${p.name}` ? '' : ` (${show(p.path)})`);

  // Workspace folders: those package.json declares (when given), or every folder entry of the lock file.
  let workspaces = (lock.workspaces || []).map((w) => (typeof w === 'string' ? w : w.path));
  if (o.pkg && o.pkg.workspaces.length) {
    const patterns = o.pkg.workspaces.map((w) => globToRegExp(w.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')));
    workspaces = workspaces.filter((w) => patterns.some((re) => re.test(w)));
  } else if (o.pkg) workspaces = [];
  const context = { registries: cfg.registries, workspaces };

  const packages = lock.packages || [];
  for (const p of packages) {
    const src = classifySource(p, context);
    const id = `${label(p)}${where(p)}`;
    const resolved = p.resolved === null ? '' : show(p.resolved);

    if (src.kind === 'git' && !(src.host && cfg.gitHosts.includes(src.host))) {
      add('non-registry-source', 'error', p, `${id} comes from a git repository (${resolved}), not a registry: what is installed is whatever that repository holds, with no registry integrity hash. Publish it to your registry, or add the host to "gitHosts" in the config when it is trusted`);
    } else if (src.kind === 'tarball') {
      add('non-registry-source', 'error', p, `${id} is downloaded from ${resolved}, a URL that is not on a configured registry. Publish it to your registry, or add the host to "registries" in the config when it is one`);
    } else if (src.kind === 'local') {
      add('non-registry-source', 'error', p, `${id} is installed from a local ${p.link ? 'folder' : 'file or folder'} (${resolved || 'no path recorded'}) outside the workspaces; a build on another machine gets whatever is at that path, or fails`);
    } else if (src.kind === 'other-registry') {
      add('registry-mismatch', 'warning', p, `${id} comes from ${resolved}, a registry at ${show(src.host)}, not ${quoteList(cfg.registries.map(show), 3)}; add the host to "registries" in the config when it is your registry or a mirror of it`);
    }
    if (src.insecure) {
      add('insecure-url', 'error', p, `${id} is resolved over an unencrypted connection (${resolved}); anyone on the network path can change what is installed. Use https`);
    }

    if (p.inBundle) {
      // Covered by the bundled check: the parent's tarball holds it.
    } else if (src.kind === 'workspace') {
      add('missing-integrity', 'info', p, `${show(p.name)} is a link to the workspace ${resolved}; workspace links have no integrity hash, as expected`);
    } else if (['registry', 'other-registry', 'tarball', 'unknown'].includes(src.kind)) {
      if (!p.integrity) {
        add('missing-integrity', 'error', p, `${id} has no integrity hash${p.resolved ? '' : ' and no resolved URL'}, so npm cannot check that the download is the file that was locked. Delete the entry and run npm install to record it again`);
      }
    }
    if (p.integrity) {
      const algos = p.integrity.trim().split(/\s+/).map((t) => t.split('-')[0].toLowerCase());
      if (algos.length && algos.every((a) => a === 'sha1')) {
        add('weak-integrity', 'warning', p, `${id} is checked with a SHA-1 hash only, which can be forged; reinstall it from the registry to record a sha512 hash`);
      }
    }

    if (p.hasInstallScript) {
      const allowed = cfg.allowInstallScripts.some((n) => nameMatches(n, p.name, p.version));
      if (!allowed) add('install-script', 'warning', p, `${id} runs an install script (preinstall, install or postinstall) when it is installed; review it, then add it to "allowInstallScripts" in the config, or install with --ignore-scripts`);
    }
    if (p.deprecated) add('deprecated', 'info', p, `${id} is deprecated: ${show(p.deprecated)}`);
    if (lock.hasLicenses && !p.link && !p.hasLicense) add('license-missing', 'info', p, `${id} has no license field in the lock file; check its license before shipping it`);
  }

  // Bundled dependencies, by the package that bundles them.
  const bundles = new Map();
  for (const p of packages) {
    if (!p.inBundle) continue;
    const parent = p.path.slice(0, p.path.lastIndexOf('/node_modules/'));
    if (!bundles.has(parent)) bundles.set(parent, []);
    bundles.get(parent).push(p);
  }
  for (const [parentPath, list] of bundles) {
    const parent = packages.find((p) => p.path === parentPath) || { name: parentPath.slice(parentPath.lastIndexOf('node_modules/') + 13) || parentPath, version: null, path: parentPath };
    add('bundled', 'info', parent, `${label(parent)}${where(parent)} bundles ${plural(list.length, 'package')} inside its tarball (${quoteList(list.map(label))}); bundled packages have no integrity hash of their own`);
  }

  // The same package in many versions.
  const versions = new Map();
  for (const p of packages) {
    if (p.link || p.version === null) continue;
    if (!versions.has(p.name)) versions.set(p.name, { first: p, set: new Set() });
    versions.get(p.name).set.add(p.version);
  }
  for (const [name, { first, set }] of versions) {
    if (set.size <= o.maxVersions) continue;
    const list = [...set].sort((a, b) => {
      const va = parseVersion(a);
      const vb = parseVersion(b);
      return va && vb ? compareVersions(va, vb) : a < b ? -1 : a > b ? 1 : 0;
    });
    add('duplicate-versions', 'info', { name, version: null, path: first.path }, `${show(name)} is locked in ${set.size} versions (${quoteList(list.map(show), 8)}), more than --max-versions ${o.maxVersions}; each copy is code to install, audit and update`);
  }

  // package.json against the lock file.
  let direct = null;
  const root = lock.root || { dependencies: {}, devDependencies: {}, optionalDependencies: {}, recorded: false };
  const rootRanges = { ...root.optionalDependencies, ...root.devDependencies, ...root.dependencies };
  if (root.recorded) direct = Object.keys(rootRanges).length;
  if (o.pkg) {
    const declared = new Map();
    for (const kind of ['optionalDependencies', 'devDependencies', 'dependencies']) for (const [n, r] of Object.entries(o.pkg[kind])) declared.set(n, { range: r, kind });
    if (direct === null) direct = declared.size;
    const top = new Map(packages.filter((p) => p.path === `node_modules/${p.name}`).map((p) => [p.name, p]));
    const wsVersion = new Map((lock.workspaces || []).filter((w) => typeof w !== 'string').map((w) => [w.path, w.version]));
    const rootEntry = { name: null, version: null, path: null };
    for (const [name, { range, kind }] of declared) {
      const entry = top.get(name);
      const subject = entry || { name, version: null, path: null };
      const problems = [];
      if (root.recorded && rootRanges[name] === undefined) problems.push(`it is not in the root of the lock file`);
      else if (root.recorded && rootRanges[name] !== range) problems.push(`the lock file was written for "${show(rootRanges[name])}"`);
      if (!entry) {
        problems.push(`no version of it is locked`);
      } else {
        const version = entry.link ? wsVersion.get((entry.resolved ?? '').replace(/\\/g, '/')) ?? null : entry.version;
        if (version !== null) {
          const s = satisfies(version, range);
          if (s.ok && !s.match) problems.push(`the locked version ${show(version)} does not satisfy it`);
          if (!s.ok && !problems.length) {
            add('lock-out-of-sync', 'info', { ...subject, version }, `${show(name)}: the range "${show(range)}" in package.json (${kind}) is ${show(s.reason)}; it was not compared with the locked version ${show(version)}`);
          }
        } else if (!problems.length && !entry.link) {
          add('lock-out-of-sync', 'info', subject, `${show(name)}: the lock file records no version for it (${show(entry.resolved ?? 'no source')}); "${show(range)}" was not compared`);
        }
      }
      if (problems.length) {
        add('lock-out-of-sync', 'error', subject, `${show(name)}: package.json (${kind}) asks for "${show(range)}", but ${problems.join(', and ')}. Run npm install and commit the lock file, or npm ci will refuse it`);
      }
    }
    if (root.recorded) {
      for (const name of Object.keys(rootRanges)) {
        if (declared.has(name)) continue;
        add('lock-out-of-sync', 'error', { ...rootEntry, name }, `${show(name)} is a dependency in the root of the lock file but not in package.json; run npm install and commit the lock file, or npm ci will refuse it`);
      }
    }
  } else {
    notes.push('no --package given: package.json was not compared with the lock file (lock-out-of-sync)');
  }

  // Ignore rules from the config.
  const kept = [];
  let ignored = 0;
  for (const f of all) {
    const hit = cfg.ignore.some((r) => (r.check === null || r.check === f.id) && (r.package === null || (f.package !== null && nameMatches(r.package, f.package, f.version))));
    if (hit) ignored += 1;
    else kept.push(f);
  }
  if (ignored) notes.push(`${plural(ignored, 'finding')} left out by "ignore" rules in the config`);

  kept.sort((a, b) => RANK[a.severity] - RANK[b.severity] || ORDER[a.id] - ORDER[b.id] || ((a.path ?? '') < (b.path ?? '') ? -1 : (a.path ?? '') > (b.path ?? '') ? 1 : 0));
  const counts = { error: 0, warning: 0, info: 0 };
  const byCheck = Object.fromEntries(FINDINGS.map((f) => [f.id, 0]));
  for (const f of kept) {
    counts[f.severity] += 1;
    byCheck[f.id] += 1;
  }
  const failing = kept.filter((f) => meetsThreshold(f.severity, o.failOn));
  const errors = failing.filter((f) => f.severity === 'error').length;
  const warnings = failing.length - errors;
  const reason = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' and ');

  const installed = packages.filter((p) => !p.link);
  const scripts = installed.filter((p) => p.hasInstallScript).map((p) => ({
    package: show(p.name), version: p.version === null ? null : show(p.version), path: show(p.path),
    allowed: cfg.allowInstallScripts.some((n) => nameMatches(n, p.name, p.version))
  }));
  if (kept.length > o.limit) notes.push(`showing the first ${plural(o.limit, 'finding')} of ${kept.length.toLocaleString('en-US')}; raise --limit to see more`);
  if (scripts.length > o.limit) notes.push(`showing the first ${o.limit.toLocaleString('en-US')} of ${scripts.length.toLocaleString('en-US')} packages with install scripts`);

  return {
    tool: 'lockfile-check',
    lockfileVersion: lock.lockfileVersion,
    sources: o.sources ? Object.fromEntries(Object.entries(o.sources).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, safeText(v, 300)])) : null,
    summary: {
      packages: installed.length,
      direct,
      dev: installed.filter((p) => p.dev).length,
      optional: installed.filter((p) => p.optional).length,
      installScripts: scripts.length,
      links: packages.length - installed.length,
      bundled: installed.filter((p) => p.inBundle).length,
      registries: cfg.registries.map((r) => safeText(r, 100))
    },
    counts,
    byCheck,
    total: kept.length,
    ignored,
    limit: o.limit,
    findings: kept.slice(0, o.limit).map((f) => ({
      ...f,
      package: f.package === null ? null : show(f.package),
      version: f.version === null ? null : show(f.version),
      path: f.path === null ? null : show(f.path)
    })),
    installScripts: scripts.slice(0, o.limit),
    notes: notes.map((n) => safeText(n, 1200)),
    gate: { failOn: o.failOn, pass: failing.length === 0, reason: failing.length ? reason : '' }
  };
}
