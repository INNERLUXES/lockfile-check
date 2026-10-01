// Reads the inputs safely: the lock file, package.json and the config file, each bounded in size,
// and turns a lock file of any supported version into one flat list of package entries.

import { readFile, stat } from 'node:fs/promises';

export const LIMITS = {
  maxFileBytes: 100 * 1024 * 1024,
  maxPackages: 200_000
};

export const LOCK_VERSIONS = [1, 2, 3];

function mb(bytes) {
  return `${bytes / 1024 / 1024} MB`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Reads a file named on the command line as UTF-8 text within the size limit. A byte order mark is dropped.
export async function readBounded(path, limits = LIMITS) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path}: not a file`);
  if (info.size > limits.maxFileBytes) throw new Error(`${path}: ${info.size} bytes is over the ${mb(limits.maxFileBytes)} limit`);
  return (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
}

// Parses JSON, naming the file in the error.
export function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: not valid JSON (${error.message})`);
  }
}

// The package name of an entry of the "packages" map: the part after the last "node_modules/".
// Keys without "node_modules/" are workspace folders (or the root, "").
export function nameFromPath(path) {
  const i = path.lastIndexOf('node_modules/');
  if (i === -1) return null;
  return path.slice(i + 'node_modules/'.length);
}

function text(v) {
  return typeof v === 'string' ? v : null;
}

function depMap(v) {
  if (!isObject(v)) return {};
  const out = {};
  for (const [k, r] of Object.entries(v)) if (typeof r === 'string') out[k] = r;
  return out;
}

function entryOf(path, e, extra = {}) {
  return {
    path,
    name: text(e.name) ?? nameFromPath(path) ?? path,
    version: text(e.version),
    resolved: text(e.resolved),
    integrity: text(e.integrity),
    link: e.link === true,
    dev: e.dev === true || e.devOptional === true,
    optional: e.optional === true || e.devOptional === true,
    inBundle: e.inBundle === true,
    hasInstallScript: e.hasInstallScript === true,
    deprecated: text(e.deprecated),
    license: text(e.license) ?? (isObject(e.license) ? text(e.license.type) : null),
    hasLicense: e.license !== undefined,
    ...extra
  };
}

// lockfileVersion 2 and 3: the "packages" map, keyed by the folder each package is installed in.
function fromPackages(data, label, limits) {
  const keys = Object.keys(data.packages);
  const count = keys.length - (Object.hasOwn(data.packages, '') ? 1 : 0);
  if (count > limits.maxPackages) {
    throw new Error(`${label}: ${count.toLocaleString('en-US')} package entries is over the limit of ${limits.maxPackages.toLocaleString('en-US')}`);
  }
  const root = isObject(data.packages['']) ? data.packages[''] : {};
  const packages = [];
  const workspaces = [];
  for (const key of keys) {
    if (key === '') continue;
    const e = data.packages[key];
    if (!isObject(e)) throw new Error(`${label}: the entry "${key.slice(0, 200)}" of "packages" is not an object`);
    if (nameFromPath(key) === null) {
      workspaces.push({ path: key, name: text(e.name), version: text(e.version) });
      continue;
    }
    packages.push(entryOf(key, e));
  }
  return {
    root: {
      name: text(root.name), version: text(root.version),
      dependencies: depMap(root.dependencies), devDependencies: depMap(root.devDependencies),
      optionalDependencies: depMap(root.optionalDependencies), peerDependencies: depMap(root.peerDependencies),
      recorded: true
    },
    packages, workspaces, notes: []
  };
}

// lockfileVersion 1: the nested "dependencies" tree, walked without recursion. Version 1 records no install
// scripts and no licenses; a git or local dependency keeps its source in "version".
function fromTree(data, label, limits) {
  const packages = [];
  const stack = Object.entries(data.dependencies).reverse().map(([n, e]) => ({ name: n, e, parent: '' }));
  while (stack.length) {
    const { name, e, parent } = stack.pop();
    if (!isObject(e)) throw new Error(`${label}: the dependency "${name.slice(0, 200)}" is not an object`);
    if (packages.length >= limits.maxPackages) {
      throw new Error(`${label}: more than ${limits.maxPackages.toLocaleString('en-US')} package entries, which is over the limit`);
    }
    const path = `${parent}node_modules/${name}`;
    const version = text(e.version);
    // In version 1, "version" holds the source for git and local dependencies: "github:...", "git+ssh://...", "file:...".
    const sourceInVersion = version !== null && /^(?:[a-z][a-z0-9+.-]*:|[^@\s/]+@[^:\s/]+:)/i.test(version) && !/^\d/.test(version);
    const resolved = text(e.resolved) ?? (sourceInVersion ? version : null);
    packages.push(entryOf(path, { ...e, name, resolved, inBundle: e.bundled === true }, {
      version: sourceInVersion ? null : version,
      link: false,
      local: sourceInVersion && /^file:/i.test(version)
    }));
    if (isObject(e.dependencies)) {
      for (const [n, child] of Object.entries(e.dependencies).reverse()) stack.push({ name: n, e: child, parent: `${path}/` });
    }
  }
  return {
    root: {
      name: text(data.name), version: text(data.version),
      dependencies: {}, devDependencies: {}, optionalDependencies: {}, peerDependencies: {},
      recorded: false,
      topLevel: Object.keys(data.dependencies)
    },
    packages,
    workspaces: [],
    notes: ['lockfileVersion 1 is read from its "dependencies" tree: it records no install scripts, no licenses and no ranges for the root, so install-script, license-missing and part of lock-out-of-sync cannot be checked. npm 7 and newer rewrite it as version 3 on the next install']
  };
}

// A lock file (package-lock.json or npm-shrinkwrap.json) as { lockfileVersion, root, packages, workspaces, notes, hasLicenses }.
export function parseLock(data, label = 'lock file', limits = LIMITS) {
  if (!isObject(data)) throw new Error(`${label}: expected a JSON object`);
  const v = data.lockfileVersion;
  if (!LOCK_VERSIONS.includes(v)) {
    throw new Error(`${label}: lockfileVersion ${JSON.stringify(v ?? null).slice(0, 40)} is not supported (1, 2 or 3); is this an npm lock file?`);
  }
  let out;
  if (v === 1) {
    if (!isObject(data.dependencies)) throw new Error(`${label}: lockfileVersion 1 without a "dependencies" object`);
    out = fromTree(data, label, limits);
  } else {
    if (!isObject(data.packages)) throw new Error(`${label}: lockfileVersion ${v} without a "packages" object`);
    out = fromPackages(data, label, limits);
  }
  const hasLicenses = out.packages.some((p) => !p.link && p.hasLicense);
  return { lockfileVersion: v, ...out, hasLicenses };
}

// package.json: the dependencies it declares and its workspaces.
export function parsePackageJson(data, label = 'package.json') {
  if (!isObject(data)) throw new Error(`${label}: expected a JSON object`);
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (data[k] !== undefined && !isObject(data[k])) throw new Error(`${label}: "${k}" must be an object`);
  }
  let workspaces = [];
  if (Array.isArray(data.workspaces)) workspaces = data.workspaces.filter((w) => typeof w === 'string');
  else if (isObject(data.workspaces) && Array.isArray(data.workspaces.packages)) workspaces = data.workspaces.packages.filter((w) => typeof w === 'string');
  return {
    name: text(data.name),
    dependencies: depMap(data.dependencies),
    devDependencies: depMap(data.devDependencies),
    optionalDependencies: depMap(data.optionalDependencies),
    workspaces
  };
}

// The line on which each key of an object first appears in the lock file, so a report can point at it.
// Only lines of the form   "key": {   are read; the first time a key appears wins.
export function keyLines(source, max = LIMITS.maxPackages * 4) {
  const lines = new Map();
  let line = 1;
  let start = 0;
  let count = 0;
  while (start <= source.length && count < max) {
    const end = source.indexOf('\n', start);
    const row = source.slice(start, end === -1 ? source.length : end);
    const m = /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*\{/.exec(row);
    if (m && !lines.has(m[1])) {
      lines.set(m[1], line);
      count += 1;
    }
    if (end === -1) break;
    start = end + 1;
    line += 1;
  }
  return lines;
}
