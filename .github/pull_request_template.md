## What changes

<!-- One or two sentences. -->

## Checks

- [ ] `npm test`, `npm run check` and `npm run example` pass
- [ ] A change to a check or to the range matcher is described in docs/method.md, and has a test with a lock file written inline
- [ ] Text from the input goes through `safeText`, so credentials in URLs are masked; the tool still runs no npm, fetches nothing and opens no connection
- [ ] No real project's lock file and no real token in fixtures or examples
- [ ] The commit messages of this pull request follow Conventional Commits
