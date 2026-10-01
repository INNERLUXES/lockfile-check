# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "lockfile-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up lock file (and `package.json` or config, if they matter) that shows the problem, what you expected and what happened. Use made-up package names and hosts, and no real tokens, internal registry addresses or customer data.

## Scope

In scope:

- an input that makes the tool open a network connection, run a program (npm, git, an install script), or read a file it was not given
- an input that makes the tool hang, take very long, or use unbounded memory or stack, such as a deeply nested version 1 tree or a crafted version range
- a token or password in a lock file URL that appears unmasked in any report format
- text from a package name, a version, a URL or a deprecation message that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- a config file with a mistake that is silently ignored, so a run passes with a check switched off
- a package reported as clean when the rule in docs/method.md says it should be reported, such as a git or http source, a missing hash or an unlisted install script

Out of scope: known vulnerabilities in packages, what an install script does, and lock files of other package managers (docs/limits.md lists what a lock file check cannot see).

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
