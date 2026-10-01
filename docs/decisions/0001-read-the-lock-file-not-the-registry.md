# 1. Read the lock file, do not ask the registry

## Context

The tool needs to know, for every package a Node.js back end installs, where it comes from and whether npm can verify it. There are richer ways to get that: run `npm ls` or `npm install --dry-run` and read their output, ask the registry for each package's metadata (maintainers, publish history, signatures, install scripts in the published `package.json`), or download the tarballs and look inside. Each of them means running npm, with the project's `.npmrc`, its registry tokens and possibly its install scripts, or opening hundreds of network connections from the build job, every time the check runs. The answers would change from day to day as the registry changes, so the same commit could pass today and fail tomorrow. And the check would need network access in the one place where it is most useful: before `npm ci`, when nothing from the lock file should have run yet.

## Decision

The tool reads the lock file, and `package.json` and a config file when given, as JSON, and nothing else. It never runs npm, git or any other program, never fetches a URL from the lock file, and never asks a registry anything. Everything it reports is a fact written in those files: the `resolved` URL, the `integrity` hash, `hasInstallScript`, `inBundle`, `deprecated`, `license`, the ranges of the root and the versions of the entries. Version ranges are matched by a small matcher inside the tool, not by npm.

## Consequences

The check runs in a second, anywhere Node runs, with no network access and no tokens, before anything is installed, and the same files always give the same report, so it can gate a pull request that changes the lock file. No input can make it run code or reach out to a host. The cost is that it knows only what npm wrote down: it does not see known vulnerabilities, what an install script does, who maintains a package, or anything the registry learned after the lock file was written. The README and docs/limits.md say so, and recommend `npm audit` or a dependency scanner as a separate step.
