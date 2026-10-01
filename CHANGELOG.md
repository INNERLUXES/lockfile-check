# Changes

## 1.0.0

First release.

- Checks an npm lock file (`package-lock.json` or `npm-shrinkwrap.json`) for supply-chain risks before a Node.js back end is built or deployed. Reads files only; never runs npm and never fetches anything.
- Reads lockfileVersion 2 and 3 through the `packages` map, and lockfileVersion 1 through its `dependencies` tree, with a note on what version 1 does not record.
- Eleven checks: `non-registry-source`, `insecure-url`, `lock-out-of-sync`, `missing-integrity`, `registry-mismatch`, `weak-integrity`, `install-script`, `duplicate-versions`, `deprecated`, `license-missing` and `bundled`.
- Compares `package.json` with the lock file (`--package`): declared dependencies missing from the lock file, ranges that differ from the root of the lock file, and locked versions outside their range, with a built-in range matcher for exact versions, `^`, `~`, comparisons, `x` and `*`, `||` and hyphen ranges, and npm's prerelease rule. Other forms are reported as info, not guessed.
- Workspace links are told apart from links and `file:` paths outside the workspaces.
- Config file in JSON: `registries`, `gitHosts`, `allowInstallScripts` (by name or name@version) and `ignore` rules by check and package. Unknown keys and checks stop the run.
- Reports as text, Markdown, JSON, CSV and SARIF 2.1.0, with a summary of the packages, a table of the packages with install scripts, and the findings (`--limit`, with the total always shown); `--fail-on` for a pipeline gate.
- Safe input: user names and tokens in URLs are masked in every format, files over 100 MB and more than 200,000 package entries stop the run, and control characters are removed from every text shown.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.
