# Contributing

Use Node.js 22.12 or later, install dependencies with `npm ci --ignore-scripts`, and run `npm run check` before opening a pull request. Format changes with `npm run format`.

Include a regression test for behavior changes and update examples when the API
changes. Tests should use mock providers rather than paid API calls. Describe
security limitations alongside features that depend on heuristic checks.

`npm run check` installs the actual tarball into an isolated consumer without optional provider SDKs, compiles its public types, and exercises the package and CLI. CI also runs this consumer on Node 22.0.0, 24 and 26; the existing `ci` check remains required. For packaging changes, also run `npm pack --dry-run` and check the file list.
Releases use `.github/workflows/publish.yml`. Publish a GitHub release with a
`v<version>` tag matching `package.json`; the tagged commit must be reachable from
`main`. The workflow tests and builds the package before requesting approval
through the `npm-publish` environment. Its separate publish job receives the
`NPM_TOKEN` secret and publishes the built tarball with lifecycle scripts disabled.

CodeQL scans TypeScript and workflow files on pull requests, updates to `main`,
and a weekly schedule. Dependabot checks npm dependencies and Actions versions
weekly. Workflow changes take effect once they reach GitHub; local checks do not
replace the required checks or reviews configured on the repository.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
