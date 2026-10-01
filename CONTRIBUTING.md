# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, with `!` for a breaking change.

## Changing a check

1. Describe the change in docs/method.md first: what the check reports, its severity, and why it matters for the supply chain of a Node.js service, with the part of the npm documentation on package-lock.json, the OWASP Top 10 or NIST SP 800-218 it follows. Where the tool makes its own choice (what counts as a registry tarball, which links are workspaces, the prerelease rule), say so and say why.
2. Add a test with the lock file written inline, small enough that the result can be worked out by hand. Use made-up package names and hosts.
3. Text from the input goes through `safeText` before it reaches a finding or a note, so credentials in URLs are masked and control characters removed.
4. A finding id, once released, keeps its meaning: pipelines and code scanning read it from the JSON, CSV and SARIF reports.

## Changing the range matcher

1. Add a test for every form you add, with versions just inside and just outside the range, and a prerelease.
2. When a form cannot be read with certainty, report it as unsupported; never treat it as a match or a mismatch.
3. Keep every pattern anchored and free of nested repetition, and keep the length limit on ranges.

## Rules for the code

- No runtime dependencies. Node 22 or newer and nothing else.
- The tool reads the files it is given and writes only to the screen. It opens no network connection, runs no program (no npm, no git, no install script), and never follows a URL from a lock file.
- Source files stay ASCII; write any other character in a pattern as a `\u` escape.
- Never commit a real project's lock file, even as a fixture. Write small made-up lock files with names that start with `example-`, and never put a real token into a URL, even an expired one.

## Before you open the pull request

```
npm test
npm run check
npm run example
```
