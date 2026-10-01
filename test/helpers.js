// Shared test helpers: lock files written inline, and a temporary folder removed after the test.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseLock, parsePackageJson, checkLock, parseConfig } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'lockfile-check-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const SRI = 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export function reg(name, version, host = 'registry.npmjs.org') {
  return `https://${host}/${name}/-/${name.split('/').pop()}-${version}.tgz`;
}

// A registry entry with a resolved URL, a sha512 integrity hash and a license, plus any extra fields.
export function entry(name, version, extra = {}) {
  return { version, resolved: reg(name, version), integrity: SRI, license: 'MIT', ...extra };
}

// A lockfileVersion 3 document from a map of packages, with the root's dependencies.
export function lockV3(packages, root = {}) {
  return { name: 'example-app', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'example-app', version: '1.0.0', ...root }, ...packages } };
}

// Parses and checks inline documents in one step.
export function check(lockDoc, { pkg = null, config = null, ...options } = {}) {
  return checkLock(parseLock(lockDoc), { pkg: pkg ? parsePackageJson(pkg) : null, config: parseConfig(config), ...options });
}

export const ids = (report) => report.findings.map((f) => f.id);
export const find = (report, id) => report.findings.filter((f) => f.id === id);
