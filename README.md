# lockfile-check

Checks an npm lock file (`package-lock.json` or `npm-shrinkwrap.json`) for supply-chain risks before a Node.js back end is built or deployed. It reads where every package was resolved from, whether its integrity hash is there and strong, whether it runs a script on install, and whether the lock file still matches `package.json`, and fails the pipeline when something needs a person to look at it.

A Node.js back end depends on hundreds of packages, and most of them were never chosen by anyone on the team: they came in as dependencies of dependencies. `npm ci` installs exactly what the lock file says, so the lock file is the real list of code that will run on the server, with the database password and the payment keys in its environment. It also records, for every package, where it came from and the hash it must match. A package that comes from a git branch instead of the registry, a tarball downloaded over plain `http://`, an entry with no integrity hash, a new package that runs a postinstall script, or a lock file that no longer matches `package.json` are all easy to miss in a pull request that changes thousands of lines of JSON. This tool reads that JSON and says, in plain words, which of those things the change brings in.

- Every finding has an id, a severity (error, warning, info), the package, its version and its path in the lock file, and a plain message with what to do.
- It reads lockfileVersion 2 and 3 through their `packages` map, and version 1 through its `dependencies` tree, with a note on what version 1 does not record.
- With `package.json` it checks that the lock file is in sync: every declared dependency is locked, and every locked version satisfies its range.
- Reports as text, Markdown, JSON, CSV and SARIF, so findings can show up in GitHub code scanning.
- It reads files only. It never runs npm, installs nothing, fetches nothing and opens no network connection.
- Plain JavaScript, no dependencies; the same files always give the same report.

```
npm test
```

```
ℹ tests 56
ℹ pass 56
ℹ fail 0
```

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/lockfile-check.git
cd lockfile-check
node bin/lockfile-check.js --lock examples/orders-api/package-lock.json --package examples/orders-api/package.json
```

Or without a clone, in the folder of your service:

```
npx --yes github:INNERLUXES/lockfile-check --lock package-lock.json --package package.json
```

`examples/orders-api` is a made-up orders API: an HTTP server, a router, a database client with an optional native part, a logger, a validator, test and lint tools, and one workspace package. Every package comes from the registry with a sha512 hash, and the run passes with one info line (the workspace link, which has no hash by design).

`examples/risky` is a made-up payments API whose lock file has the problems the tool looks for. All package names start with `example-` and do not refer to real packages; the hashes are made up too.

```
node bin/lockfile-check.js --lock examples/risky/package-lock.json --package examples/risky/package.json
```

```
lockfile-check: lock examples/risky/package-lock.json (lockfileVersion 3), package examples/risky/package.json
packages: 16 locked (10 direct, 2 dev, 0 optional), 2 with install scripts, 0 links, 1 bundled
findings: 6 error, 4 warning, 6 info

Install script       Version  Path                              Allowed
example-image-tool   0.33.2   node_modules/example-image-tool   no
example-native-hash  5.1.2    node_modules/example-native-hash  no

ERROR     non-registry-source  example-legacy-crypto@0.9.1 is downloaded from http://files.example.com/example-legacy-crypto-0.9.1.tgz, a URL that is not on a configured registry. Publish it to your registry, or add the host to "registries" in the config when it is one

ERROR     non-registry-source  example-pdf-render@1.3.0 comes from a git repository (git+ssh://git@github.com/example-org/example-pdf-render.git#431ec36f08d24a7270184a8e8fcd4aac5fac23f8), not a registry: what is installed is whatever that repository holds, with no registry integrity hash. Publish it to your registry, or add the host to "gitHosts" in the config when it is trusted

ERROR     insecure-url         example-legacy-crypto@0.9.1 is resolved over an unencrypted connection (http://files.example.com/example-legacy-crypto-0.9.1.tgz); anyone on the network path can change what is installed. Use https

ERROR     lock-out-of-sync     example-mailer: package.json (dependencies) asks for "^1.0.0", but it is not in the root of the lock file, and no version of it is locked. Run npm install and commit the lock file, or npm ci will refuse it

ERROR     lock-out-of-sync     example-orm: package.json (dependencies) asks for "^3.0.0", but the lock file was written for "^2.8.0", and the locked version 2.8.1 does not satisfy it. Run npm install and commit the lock file, or npm ci will refuse it

ERROR     missing-integrity    example-date-utils@2.29.4 has no integrity hash, so npm cannot check that the download is the file that was locked. Delete the entry and run npm install to record it again

WARNING   registry-mismatch    example-private-auth@2.1.0 comes from https://***@npm.example.internal/example-private-auth/-/example-private-auth-2.1.0.tgz, a registry at npm.example.internal, not registry.npmjs.org; add the host to "registries" in the config when it is your registry or a mirror of it

WARNING   weak-integrity       example-legacy-crypto@0.9.1 is checked with a SHA-1 hash only, which can be forged; reinstall it from the registry to record a sha512 hash

WARNING   install-script       example-image-tool@0.33.2 runs an install script (preinstall, install or postinstall) when it is installed; review it, then add it to "allowInstallScripts" in the config, or install with --ignore-scripts

WARNING   install-script       example-native-hash@5.1.2 runs an install script (preinstall, install or postinstall) when it is installed; review it, then add it to "allowInstallScripts" in the config, or install with --ignore-scripts

INFO      lock-out-of-sync     example-legacy-crypto: the range "http://files.example.com/example-legacy-crypto-0.9.1.tgz" in package.json (dependencies) is a URL or protocol specifier (http:), not a version range; it was not compared with the locked version 0.9.1

INFO      lock-out-of-sync     example-pdf-render: the range "github:example-org/example-pdf-render#v1.3.0" in package.json (dependencies) is a URL or protocol specifier (github:), not a version range; it was not compared with the locked version 1.3.0

INFO      duplicate-versions   example-debug-log is locked in 5 versions (2.6.9, 3.1.0, 3.2.7, 4.1.1, 4.3.4), more than --max-versions 3; each copy is code to install, audit and update

INFO      deprecated           example-request-lite@2.88.2 is deprecated: example-request-lite is no longer maintained; use the fetch built into Node

INFO      license-missing      example-request-lite@2.88.2 has no license field in the lock file; check its license before shipping it

INFO      bundled              example-image-tool@0.33.2 bundles 1 package inside its tarball (example-png-codec@1.6.0); bundled packages have no integrity hash of their own

GATE: FAIL - 6 errors
```

The exit code is `1`. The lock file of the risky example records a deploy token inside the URL of `example-private-auth`; the report shows it as `***`, in every format. `examples/risky/lockfile-check.json` is the config a team might write after reviewing these findings: it adds the private registry, allows the one install script it has read, and ignores the deprecation it already plans to fix. With it, the warnings for the registry and the reviewed script go away, and the run still fails on the six errors.

## Usage

```
lockfile-check --lock <package-lock.json> [--package <package.json>] [options]
```

```
--lock <file>           package-lock.json or npm-shrinkwrap.json (lockfileVersion 1, 2 or 3)
--package <file>        package.json, to compare the declared dependencies with the lock file
--config <file>         allowed registries and git hosts, allowed install scripts, ignore rules (JSON)
--format <name>         text, markdown, json, csv or sarif (default: text)
--fail-on <level>       exit with 1 when a finding is at this level or above: error or warning
                        (default: error)
--limit <n>             show at most n findings (default: 200); the total is always shown
--max-versions <n>      report a package locked in more than n versions (default: 3)
--help                  show the usage
--version               show the version
```

Without `--package`, everything except `lock-out-of-sync` is checked, and a note says so. Pass the `package.json` that sits next to the lock file.

## Checks

| Id | Severity | What it reports |
| --- | --- | --- |
| `non-registry-source` | error | A package resolved from git (`git+ssh:`, `git+https:`, `github:` and the other shorthands), from an `http(s)` tarball URL that is not on a configured registry, or from a `file:` path or link outside the workspaces |
| `insecure-url` | error | A package resolved over `http://`, `git://` or `git+http://` |
| `lock-out-of-sync` | error / info | A dependency in `package.json` missing from the lock file, a range that differs from the one the lock file was written for, or a locked version outside the range; info when the range is a form the matcher does not read |
| `missing-integrity` | error / info | A package downloaded from a registry or URL without an `integrity` hash; info for workspace links, which never have one |
| `registry-mismatch` | warning | A registry tarball (`/<name>/-/<file>.tgz`) from a host that is not one of the configured registries (default `registry.npmjs.org`) |
| `weak-integrity` | warning | A package whose only integrity hash is SHA-1 |
| `install-script` | warning | A package with `hasInstallScript: true` that is not on the allow list |
| `duplicate-versions` | info | One package name locked in more than `--max-versions` versions |
| `deprecated` | info | A package with a deprecation message in the lock file |
| `license-missing` | info | A package without a `license` field, when the lock file records licenses for others; silent when it records none |
| `bundled` | info | A package that ships bundled dependencies, which have no integrity hash of their own |

[docs/method.md](docs/method.md) gives each check, the version range rules and why each one matters.

## Config file

```json
{
  "registries": ["registry.npmjs.org", "npm.example.internal"],
  "gitHosts": ["git.example.internal"],
  "allowInstallScripts": ["example-native-hash@5.1.2", "example-db-native"],
  "ignore": [
    { "check": "deprecated", "package": "example-request-lite", "reason": "replaced by fetch in the next release" }
  ]
}
```

- `registries`: the registry hosts packages may come from. It replaces the default (`registry.npmjs.org`), so list it too when you use it. A tarball from any of these hosts is a registry package.
- `gitHosts`: hosts whose git dependencies are accepted. Leave it empty unless the repositories on that host are as well guarded as your own code.
- `allowInstallScripts`: packages whose install scripts have been read and accepted, as `name` (every version) or `name@version` (one version). Prefer the second form, so a new version is reviewed again.
- `ignore`: findings to leave out, by `check`, by `package` (`name` or `name@version`), or both. `reason` is for the reader and is not used. The report says how many findings were left out.

Every key is checked. An unknown key, a host that is not a host name, or an ignore rule for a check that does not exist stops the run with exit code 2, so a typo cannot quietly turn a check off.

## Formats

- `text`: for a terminal: the summary, the packages with install scripts, then the findings, errors first.
- `markdown`: the same for a pull request comment or the job summary. Pipes and line breaks from the lock file are escaped, so a package name cannot break a table.
- `json`: the whole report, with package, version, path and line for every finding.
- `csv`: one row per finding and per package with an install script, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.
- `sarif`: a SARIF 2.1.0 log. Each result points at the lock file, at the line where the package entry starts, with the package path as its logical location.

To see the findings in GitHub code scanning, write the SARIF log and upload it:

```yaml
permissions:
  contents: read
  security-events: write
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  - name: Check the lock file
    run: npx --yes github:INNERLUXES/lockfile-check --lock package-lock.json --package package.json --format sarif > lockfile-check.sarif
  - uses: github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2
    if: always()
    with:
      sarif_file: lockfile-check.sarif
      category: lockfile-check
```

The step fails the job on an error; `if: always()` still uploads the log so the findings appear on the pull request. Run it before `npm ci`, so a lock file that brings in a git dependency or an install script is stopped before anything is installed.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error), `2` a usage or input error (a missing option, a missing file, a file that is not a lock file, an unsupported lockfileVersion, a config with an unknown key, a file over 100 MB, more than 200,000 package entries).

## Limits

The tool reads where packages come from; it does not know what is in them. It does not look up known vulnerabilities: pair it with `npm audit` or a dependency scanner. It cannot tell whether an install script is harmful, only that one runs. It reads npm lock files only, not those of Yarn, pnpm or Bun. [docs/limits.md](docs/limits.md) lists these, with the size limits.

## Background

- How Node.js back ends are built and kept safe to deploy, with checks like this one in the pipeline: [Node.js web development](https://innerluxes.dev/web-development/nodejs).

## License

MIT
