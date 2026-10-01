# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No network.** The tool reads the files it is given and sends nothing anywhere. It does not ask a registry about a package, does not resolve host names, does not follow a `resolved` URL, does not clone a git dependency, and does not check for updates. An address given where a file is expected is refused. It can run in a locked-down build job with no outbound access at all, before anything has been installed.
- **No npm, no commands.** The tool never runs npm, git, a shell or any other program, and never runs an install script. It reads the lock file as JSON and its fields as text. No name, version, path or URL from the input is ever put on a command line.
- **No dependencies.** Node 22 or newer and nothing else, so a check of the supply chain does not add a supply chain of its own. There is no `node_modules` to install before it runs.
- **One registry by default.** Without a config, only `registry.npmjs.org` counts as a registry. Every other host is a mismatch or a non-registry source until someone adds it to `registries` on purpose.
- **No git hosts by default.** Without a config, every git dependency is an error. Accepting one is a line in a reviewed file.
- **No install scripts by default.** Without a config, every package that runs an install script is a warning, with its version. Allowing one is a line in a reviewed file, and the `name@version` form makes the next version show up again.
- **Credentials never reach a report.** A user name and password (or token) in a URL are replaced by `***` before any text is shown, in all five formats, so a report can be pasted into a pull request, a job summary or a code scanning alert without leaking the token a developer's `.npmrc` put into the lock file.
- **Bounded input.** A file over 100 MB stops the run before it is read, and so does a lock file with more than 200,000 package entries. The version 1 tree is walked without recursion, and version ranges longer than 256 characters are not parsed.
- **Clean output.** Text from the lock file has control characters, line separators and direction controls removed and its length capped before it reaches a report, so a hostile package name cannot rewrite the terminal or reorder what a reviewer reads. Markdown cells escape pipes, backslashes and line breaks. CSV cells are quoted as RFC 4180 says, and a cell that a spreadsheet would read as a formula gets a leading `'`. No report renders a name as a link.
- **Strict configuration.** The config file is checked before the lock file is read. An unknown key (a typo such as `"registry"` or `"allowScripts"`), a host that is not a host name, an empty registry list, or an ignore rule for a check that does not exist stops the run with exit code 2 and the reason, instead of a run that passes because the rule it meant to set was ignored.
- **Ignore rules are visible.** Every finding left out by an ignore rule is counted, and the report says how many, so an ignore list cannot grow without anyone seeing it.
- **Unknown forms are not guessed.** A version range the matcher does not read is reported as info with the reason; it is never counted as a match. A lockfileVersion the tool does not know stops the run.
- **Fails closed.** A missing option, a missing file, a file that is not a lock file, an unsupported lockfileVersion, a file over the limit, or too many entries stops the run with exit code 2 and the reason, instead of a clean report about part of the lock file.
- **The gate is on.** Without any option, an error makes the run exit with `1`: a package from git or a plain URL, an http download, a missing hash, or a lock file out of sync with `package.json`. A pipeline that adds the tool is protected from the first run; there is no report-only mode to forget to turn off.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file, the job summary or a SARIF upload only when you need to keep it.

## Running it in a pipeline safely

1. Run the check before `npm ci`, in the same job, on the lock file of the commit being built. A lock file that brings in a git dependency or a new install script is then stopped before anything from it runs on the build machine.
2. Run the check with read access to the repository and nothing else: no deploy keys, no registry tokens, no cloud credentials. It needs none. Give the later install and deploy steps their secrets, not the check.
3. Use the tool from a pinned commit. `npx --yes github:INNERLUXES/lockfile-check#<commit>` runs exactly the code that was reviewed, not whatever the default branch holds on the day.
4. Always pass `--package`. Without it, `lock-out-of-sync` is not checked, and links to local folders that are not workspaces are not caught.
5. Keep the config file in the repository, next to the lock file it applies to, and protect it with CODEOWNERS. A pull request that adds a registry, a git host or an install script to the config is a decision to trust new code on the build machine, and should be reviewed by someone who can make it.
6. Keep the default `--fail-on error`. Add `--fail-on warning` once the lock file is clean, so that a new install script or a new registry stops a merge too.
7. Write the SARIF report and upload it to code scanning, or the Markdown report to the job summary, so the reviewer sees the findings next to the change, and keep the exit code as the gate.
8. Check every lock file the repository holds: each service of a monorepo that has its own, and `npm-shrinkwrap.json` when a package publishes one.
9. Run the check on every pull request, not only before a release. The pull request that adds a dependency is the cheapest place to ask where it comes from and whether it needs to run a script.
10. Keep `npm audit` or a dependency scanner in the same pipeline. This tool says where packages come from; a scanner says whether they have known vulnerabilities. Neither replaces the other.

## Writing a config the tool can check well

1. Start without a config. Run the tool on the current lock file, read every finding, and fix what can be fixed (reinstall entries without hashes, move git dependencies to the registry) before you allow anything.
2. List every registry you use in `registries`, including `registry.npmjs.org` if you use it. The list replaces the default, so a config with only your private registry turns every public package into a mismatch, which is what you want when everything should come through the private one.
3. Keep `gitHosts` empty if you can. If a git dependency is needed, publish it to your private registry instead; if that is not possible, add only the host your team controls, and make sure the lock file pins a full commit hash.
4. Allow install scripts one version at a time (`example-native-hash@5.1.2`), after reading the script. When the version changes, the warning comes back and the new script is read again.
5. Use `ignore` for findings you have decided to live with, with a `reason` the next reader can understand, and narrow each rule to a check and a package. A rule with only a check turns that check off for the whole lock file.
6. Review the config like code. Every line in it is a decision to trust something, and each line should name who decided and why, in the commit message or the pull request.
7. Remove lines that are no longer needed. An allowed install script for a package that is gone, or a registry nobody uses, widens what the next change can bring in without a warning.

## Keeping a Node.js lock file healthy

The tool tells you what is wrong with a lock file; these are the usual ways to keep it right, in the order they tend to pay off.

1. **Commit the lock file and install with `npm ci`.** `npm ci` installs exactly the lock file and fails when it does not match `package.json`; `npm install` in a pipeline can change it on the fly.
2. **Install from one place.** Point `.npmrc` at one registry (your private registry, proxying the public one if needed) and use scopes for private packages, so a private name can never be resolved from the public registry.
3. **Keep tokens out of the lock file.** Put registry credentials in `.npmrc` as `//host/:_authToken=${NPM_TOKEN}`, read from the environment, never in a URL. If a token shows up in a `resolved` URL, rotate it and reinstall.
4. **Prefer the registry over git.** A published version is immutable and hashed; a git reference is neither. Publish internal packages to the private registry rather than installing them from a repository.
5. **Use https everywhere.** No `http://` registry, no `git://` dependency. A registry that only serves http should be fixed or put behind a proxy that serves https.
6. **Refresh old hashes.** Entries with only SHA-1 hashes come from old lock files. Deleting the lock file entry (or the whole lock file, with care) and reinstalling records sha512 hashes.
7. **Install without scripts where you can.** `npm ci --ignore-scripts` stops every install script; then run only the ones you need (`npm rebuild <name>`). Packages that need a script to work are exactly the ones `allowInstallScripts` lists.
8. **Deduplicate.** `npm dedupe` and upgrades of the packages that pin old versions reduce `duplicate-versions`, and with them the code there is to audit.
9. **Replace deprecated packages.** A deprecated package gets no more fixes, so the next vulnerability in it stays open.
10. **Review the lock file diff.** For a dependency change, read the summary lines this tool prints and the list of added and removed packages, not every line of JSON.

## Sharing a report safely

1. A report shows package names, versions, paths and source URLs from the lock file. For an open-source project that is public anyway. For a private service it can show the names of internal packages, the host of the private registry and the names of internal git repositories: share it with the people who can see the code.
2. Credentials in URLs are always masked. Anything else that was written into a URL (an internal path, a branch name) is shown as it is.
3. A SARIF upload makes the findings visible to everyone who can see the repository's code scanning alerts. Use the Markdown or text report when the audience should be smaller.
