# Method

The tool answers one question: does this lock file install only what the team expects, from where the team expects it, in a way npm can verify? It reads the lock file named with `--lock`, and `package.json` when it is given, turns every package entry into a record of its name, version, path, source, integrity hash and flags, and runs the checks below on those records. It never runs npm and never asks a registry anything. The format it reads is the one described in the npm documentation, [package-lock.json](https://docs.npmjs.com/cli/configuring-npm/package-lock-json).

## Why the lock file is worth a gate

A Node.js back end runs every package in its `node_modules` with the same rights as its own code: the same environment variables, the same database connection, the same file system and network. Most of those packages are dependencies of dependencies that nobody on the team chose directly. The lock file is the only place that lists all of them, with the exact version of each, where it is downloaded from (`resolved`), and the hash the download must match (`integrity`). `npm ci` installs exactly that list, and fails when it does not match `package.json`.

The [OWASP Top 10](https://owasp.org/Top10/) lists vulnerable and outdated components among the main risks to web applications, and stresses knowing which components you use and where they come from, getting them only from official sources over secure links, and preferring signed or verified packages. NIST SP 800-218, the [Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final), asks for the same in its practices on protecting all forms of code from tampering (PS.1), verifying the integrity of third-party components (PW.4) and keeping the build environment under control (PO.5). A lock file check is a small, cheap piece of both: it runs on every pull request, needs no network, and turns a change to thousands of lines of JSON into a short list of facts a reviewer can judge.

A finding is an **error** when npm would install something it cannot verify, from a place outside the team's control, or would refuse to install at all: a git or plain URL source, an unencrypted download, a missing hash, a lock file out of sync. It is a **warning** when something should be looked at but may be intended: a second registry, a SHA-1 hash, an install script. It is **info** when nothing is wrong but the fact is useful.

## How the lock file is read

**lockfileVersion 2 and 3.** The `packages` object maps the folder each package is installed in (`node_modules/a`, `node_modules/a/node_modules/b`, `packages/api/node_modules/c`) to its entry. The package name is the part after the last `node_modules/`, or the entry's `name` field when it has one (aliases). The key `""` is the project itself, and its `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies` are the ranges the lock file was written for. Keys without `node_modules/` are folders of the project: workspaces, or local packages linked in. Entries with `"link": true` point at such a folder through `resolved`. Version 2 also holds a `dependencies` copy for npm 6; it is ignored, since `packages` is the complete record.

**lockfileVersion 1.** The older format has only the nested `dependencies` tree, keyed by name. The tool walks it without recursion and builds the same paths. In this version, a git or local dependency keeps its source in `version` (`github:user/repo#sha`, `file:../lib`), and the tool reads it from there. Version 1 records no install scripts, no licenses and no ranges for the root, so `install-script` and `license-missing` cannot be checked, and `lock-out-of-sync` compares `package.json` only with the top-level entries. A note says so. npm 7 and newer rewrite a version 1 file as version 3 on the next install; the tool reads the old file and writes nothing.

**Where a package comes from.** Each entry is put in one class, from its `resolved` field:

- **registry**: an `http(s)` URL on one of the configured registry hosts (`registries`, default `registry.npmjs.org`);
- **other registry**: an `http(s)` URL shaped like a registry tarball (`/<name>/-/<file>.tgz`) on another host;
- **tarball**: any other `http(s)` URL, such as a file server, a CDN or `codeload.github.com`;
- **git**: `git+ssh:`, `git+https:`, `git+http:`, `git:`, `ssh:`, the shorthands `github:`, `gitlab:`, `bitbucket:` and `gist:`, and `user@host:path` addresses;
- **local**: `file:` paths, and links whose target is outside the project (`../`, an absolute path, a drive letter) or is not a workspace;
- **workspace**: a link to a folder of the project that `package.json` lists under `workspaces` (without `--package`: any folder entry of the lock file);
- **unknown**: no `resolved` field at all, which npm writes with `omit-lockfile-registry-resolved` or for some old entries.

## The checks

| Id | Severity | Rule and why it matters |
| --- | --- | --- |
| `non-registry-source` | error | The package comes from git, a plain tarball URL, or a local path outside the workspaces. A registry keeps a published version immutable and serves it with a hash; a git branch or tag can be moved, a URL can serve a different file tomorrow, and a local path holds whatever is on the machine that runs the build. Git hosts listed in `gitHosts`, and URLs on hosts in `registries`, are accepted |
| `insecure-url` | error | The package is resolved over `http://`, `git://` or `git+http://`. Anyone on the network path (a public network, a compromised proxy, a hostile DNS answer) can change what is downloaded. With an integrity hash npm would notice the change for a registry tarball, but an http URL is often a sign that the entry was added by hand, and for git there is no hash at all |
| `lock-out-of-sync` | error / info | With `--package`: a dependency declared in `package.json` is not in the root of the lock file or has no locked entry; the root records a different range from the one `package.json` now asks for; or the locked version does not satisfy the range; or the root lists a dependency `package.json` no longer declares. `npm ci` refuses a lock file in this state, and `npm install` would silently change it, so the build no longer installs what was reviewed. A range the matcher does not read is reported as info, never guessed |
| `missing-integrity` | error / info | A package downloaded from a registry or a URL (or with no `resolved` at all) has no `integrity` field. Without it npm installs whatever the server sends. A workspace link is reported as info: it is the project's own code and has no hash by design. Git and local sources are covered by `non-registry-source`, and bundled packages by `bundled` |
| `registry-mismatch` | warning | A registry tarball comes from a host that is not in `registries`. A second registry is often a mirror or a private registry and is fine, but it is also how dependency confusion works: a package that should come from the private registry is resolved from the public one, or the other way round. Add the host to `registries` once it is known |
| `weak-integrity` | warning | Every hash in `integrity` is SHA-1. SHA-1 collisions can be produced, so a hash of that kind does not prove the download is the file that was locked. Entries from old lock files carry it; reinstalling records a sha512 hash |
| `install-script` | warning | The entry has `hasInstallScript: true`: npm runs its `preinstall`, `install` or `postinstall` script during `npm ci`, on the build machine, with the build's environment and secrets. Most such scripts compile a native module, but an install script is also the most common way a malicious package runs code. Each package is listed with its version, and the report shows a table of them all. Packages in `allowInstallScripts`, by name or name@version, are not reported |
| `duplicate-versions` | info | One package name is locked in more than `--max-versions` (default 3) distinct versions. Each copy is code to install, audit and update, and old copies often hold fixes the newest has. It is a hint to deduplicate, not a risk on its own |
| `deprecated` | info | The entry carries the deprecation message its author published. A deprecated package gets no more fixes |
| `license-missing` | info | The entry has no `license` field while other entries of the same lock file have one. npm 7 and newer record licenses in version 3 files; when the lock file records none at all, the check stays silent |
| `bundled` | info | The package ships dependencies inside its own tarball (`inBundle: true` on the entries under it). Those packages have no integrity hash of their own: they are covered only by the parent's hash, and their source cannot be checked separately. One finding per package that bundles others |

## Version ranges

`lock-out-of-sync` needs to know whether a locked version satisfies the range in `package.json`. The tool carries its own small matcher for the forms npm users write:

- exact versions, with or without `v` or `=`: `1.2.3`, `=1.2.3`, `v1.2.3`;
- `^`: `^1.2.3` is `>=1.2.3 <2.0.0`; `^0.2.3` is `>=0.2.3 <0.3.0`; `^0.0.3` is `>=0.0.3 <0.0.4`;
- `~`: `~1.2.3` is `>=1.2.3 <1.3.0`; `~1` is `>=1.0.0 <2.0.0`; `~>` is read as `~`;
- comparisons: `>`, `>=`, `<`, `<=`, with full or partial versions (`>1.2` is `>=1.3.0`, `<=1.2` is `<1.3.0`);
- wildcards and partial versions: `*`, `x`, `X`, an empty range, `1`, `1.x`, `1.2.*`;
- ranges joined by spaces (all must hold) and by `||` (one must hold);
- hyphen ranges: `1.2.3 - 2.3.4`, with partial ends (`1.2 - 2` is `>=1.2.0 <3.0.0`).

**Prereleases.** The tool follows the rule npm uses. A version with a prerelease tag (`1.3.0-beta.1`) satisfies a range only if every comparator of one `||` set holds and one comparator of that set names the same major, minor and patch with a prerelease tag of its own. So `1.3.0-beta.1` satisfies `>=1.3.0-beta.0` and `^1.3.0-beta.0`, but not `^1.2.0`, `>1` or `*`: a team that writes `^1.2.0` has not agreed to run prereleases. The upper bounds the matcher adds itself (the `<2.0.0` of `^1.2.0`) never let a prerelease in. Build metadata (`+build.5`) is ignored, as Semantic Versioning says.

**Not supported.** Dist-tags (`latest`, `next`), URLs, `git` and `github:` specifiers, `file:` and `link:`, `npm:` aliases, `workspace:` and any other `protocol:` form, GitHub shorthands (`user/repo`), and anything the matcher cannot parse. These are reported as `lock-out-of-sync` at info level, with the reason, and the locked version is not compared. They are never treated as a match or as a mismatch.

## Config, ignore rules and the gate

The config file sets the allowed registries and git hosts, the install scripts that have been reviewed, and ignore rules. An ignore rule leaves a finding out of the report and the gate; the report says how many were left out, so an ignore rule is never invisible.

`--fail-on error`, the default, makes the run exit with `1` when any error is found. `--fail-on warning` also fails on warnings. Info never fails a run. The gate counts every finding, also those beyond `--limit`, which only shortens the list that is shown.

## The report

Each report shows the inputs, a summary line (packages locked, direct dependencies, dev and optional packages, packages with install scripts, links and bundled packages), a table of the packages with install scripts and whether each is allowed, the findings ordered by severity and check, the notes, and the gate. JSON, CSV and SARIF reports carry the line of the lock file where each package entry starts, found by reading the text of the lock file for its key.

The method has no randomness and no network access: the same files always give the same report, and any change in the report comes from a change in the files.
