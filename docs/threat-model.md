# Threat model

## What the tool touches

- It reads the lock file given with `--lock`, the `package.json` given with `--package` and the config file given with `--config`, and only those. Nothing inside them is run, installed, fetched or followed as a link; URLs in the lock file are read as text.
- It writes only to the screen (standard output and standard error).
- It opens no network connection and runs no program: not npm, not git, not an install script.

## What the input may hold

A lock file is written by npm from the project's `package.json`, its `.npmrc` and the answers of every registry it asked, and a pull request from anyone can change it. It is easy to edit by hand and hard to review, since a single dependency upgrade can rewrite thousands of lines. The tool treats all three inputs as possibly hostile. A lock file can name packages from git repositories, file servers or local paths, carry URLs with user names and tokens in them, hold package names with control characters or text meant for a spreadsheet or a Markdown table, list hundreds of thousands of entries, or nest the version 1 tree deep enough to exhaust a recursive reader. A config file can try to switch checks off quietly.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A pull request adds a package from a git branch, a file server or a local path, and it is installed without anyone noticing | `non-registry-source` is an error; only hosts listed in `registries` and `gitHosts` are accepted, and the config that lists them sits in the repository where changes are reviewed |
| A package is downloaded over plain http and changed on the way | `insecure-url` is an error for `http://`, `git://` and `git+http://` |
| An entry loses its integrity hash, or carries only a SHA-1 hash, so npm cannot tell a changed download from the locked one | `missing-integrity` is an error and `weak-integrity` a warning |
| A package that should come from the private registry is resolved from another one (dependency confusion), or the other way round | `registry-mismatch` reports every registry tarball from a host that is not configured |
| A new dependency runs a malicious install script on the build machine, with its secrets | `install-script` lists every package that runs one, with its version; allowing one is an explicit, reviewed line in the config, preferably with the version |
| The lock file no longer matches `package.json`, so what is built is not what was reviewed | `lock-out-of-sync` is an error; ranges the matcher cannot read are shown as info rather than guessed |
| A token inside a `resolved` URL (`https://user:token@host/...`) is copied into a report, a job summary, a CSV file or a code scanning alert | User and password parts of every URL are replaced by `***` in every format, before any text reaches a report; the plain git user of `git+ssh://git@host` is kept |
| A package name or deprecation message rewrites the terminal through escape sequences, or reorders text with direction characters | Control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report, and the length is capped |
| A package name breaks the Markdown table in the job summary, or injects Markdown that hides a finding | Pipes, backslashes and line breaks are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A huge lock file, or one with a very large number of entries, exhausts memory or time | Files over 100 MB stop the run before they are read; more than 200,000 package entries stop the run |
| A deeply nested version 1 tree overflows the stack | The tree is walked with an explicit stack, without recursion, and the entry limit bounds it |
| A crafted version range takes exponential time to match | Ranges longer than 256 characters are refused; the matcher uses anchored expressions without nested repetition and compares numbers, never builds a pattern from the input |
| A config file with a typo (`"registry"` for `"registries"`, an ignore rule for a check that does not exist) quietly switches a check off | Unknown keys, unknown checks and malformed host names stop the run with exit code 2; every finding left out by an ignore rule is counted in a note |
| An address is given where a file is expected, and the tool is turned into a fetcher | Addresses such as `https://...` are refused for every path option; the tool has no code that opens a connection |
| A package from the lock file is run while it is checked | Nothing is installed or run; the lock file is parsed as JSON and its fields are read as text |

## Out of scope

Known vulnerabilities in the locked versions, what an install script does, whether a registry or a git host is trustworthy, and who may change the config file. docs/limits.md lists what a lock file check cannot see.
