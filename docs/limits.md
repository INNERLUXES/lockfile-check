# Limits

## What a lock file check cannot see

- **Known vulnerabilities.** The tool does not look up advisories. A package from the registry, with a sha512 hash and no install script, can still have a published vulnerability that lets an attacker into the server. Pair the check with `npm audit`, GitHub's dependency alerts or another dependency scanner, which compare the locked versions with an advisory database. This tool answers where the code comes from and whether npm can verify it; a scanner answers whether that code is known to be unsafe.
- **What an install script does.** `install-script` says that a package runs a script on install, and which version. It cannot say whether the script compiles a native module or steals the environment variables of the build. Read the script (in the package's `package.json` on the registry or in its repository) before you add it to `allowInstallScripts`, and install with `--ignore-scripts` where the build allows it.
- **What is inside a package.** A package from the right registry, with a strong hash, is exactly the file its author published, and that is all the hash proves. A hijacked maintainer account, a malicious new version, or a typo-squatted name with a valid hash all pass every check here. Review new dependencies and version jumps in the lock file diff, and keep `npm audit` or a scanner in the pipeline.
- **Whether a registry is trustworthy.** `registries` is a list of hosts the team accepts. The tool checks that every registry tarball comes from one of them; it cannot check that a private registry is configured safely, that it does not proxy unknown names to the public registry, or that scoped packages resolve where they should. Those are settings of `.npmrc` and of the registry itself.
- **Git dependencies the team trusts.** With a host in `gitHosts`, git dependencies from it are accepted. The tool does not check that the reference in `resolved` is a full commit hash rather than a branch, or who can push to that repository.
- **Other package managers.** Only npm lock files are read: `package-lock.json` and `npm-shrinkwrap.json`. `yarn.lock`, `pnpm-lock.yaml` and `bun.lock` have formats of their own and are not supported. A project that uses one of them gets no help from this tool, and an npm lock file left over next to one of them may not be what is actually installed.
- **The registry's own state.** The tool never asks the registry anything. It cannot see that a version was unpublished, that a package changed owners, or that a deprecation was added after the lock file was written. `deprecated` reports only what the lock file recorded at install time.

## Version ranges

The range matcher reads the forms listed in docs/method.md. Dist-tags, URLs, git and `file:` specifiers, `npm:` aliases, `workspace:` ranges and anything it cannot parse are reported as info and not compared, so a lock file can be out of sync in a way the tool does not see when `package.json` uses those forms. The matcher follows npm's prerelease rule and ignores build metadata; it does not implement the `includePrerelease` option or loose parsing of malformed versions.

## lockfileVersion 1

Version 1 files record no install scripts, no licenses and no ranges for the root. `install-script` and `license-missing` are not checked, and `lock-out-of-sync` compares `package.json` only with the top-level entries of the tree. A note says so. Running `npm install` with npm 7 or newer rewrites the file as version 3, after which every check applies.

## Workspaces

Links are judged against the `workspaces` of the `package.json` given with `--package`. Without `--package`, every folder entry of the lock file is taken as a workspace, so a link to a local folder inside the project that is not a workspace is accepted. Pass `--package` to have it reported.

## Size

- A lock file, `package.json` or config file over 100 MB stops the run before it is read.
- A lock file with more than 200,000 package entries stops the run with exit code 2, rather than checking part of it: a finding in the part left out would be missed.
- At most `--limit` findings (default 200) are shown; the counts, the gate and the total cover all of them.
- Text shown in a report is cut to a fixed length: 300 characters for a name, a version or a path, 1,200 for a message.

Every limit is reported, as an error or a note, so a cut is never silent.
