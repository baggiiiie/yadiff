# yadiff, yet another diff viewer

A browser diff viewer for local git/jj diffs and public GitHub pull requests. It uses [pierrecomputer](https://github.com/pierrecomputer/pierre)'s open-source packages:

- `@pierre/diffs` for parsing/rendering unified git patches
- `@pierre/trees` for the changed-file tree

## Usage

Run directly with npx (no install required):

```bash
npx yadiff <git-ref-or-range-or-jj-revset-or-github-pr-url>
npx yadiff --working
npx yadiff --staged
npx yadiff --dirty
```

Or install globally:

```bash
npm install -g yadiff
yadiff HEAD
```

Examples:

```bash
npx yadiff HEAD
npx yadiff abc123
npx yadiff main..feature
npx yadiff main...HEAD --repo ../some-repo
npx yadiff @ --repo ../some-jj-repo
npx yadiff 'mine() & mutable()' --vcs jj
npx yadiff https://github.com/oven-sh/bun/pull/30412
npx yadiff --working
npx yadiff --staged
npx yadiff --dirty
```

The command starts a local Vite/Express server, opens the browser, acquires a diff from the selected Source, and serves the patch to the browser.

## Current behavior

- In git repositories, a single ref like `abc123` uses `git show --patch abc123`. This is intentionally kept as normal Git semantics for now; merge commits can be handled with explicit ranges if needed.
- In git repositories, a range containing `..` or `...` uses `git diff --patch <range>`.
- In jj repositories, jj-looking revsets such as `@`, `@-`, `A::B`, or `mine() & mutable()` use `jj diff --git -r <revset>`.
- Public GitHub pull request URLs use GitHub's public `.diff` endpoint and render the combined PR diff only.
- Auto mode prefers git for normal git refs/ranges and falls back to jj when the argument is not a git revision. Use `--jj` or `--vcs jj` to force jj for local targets.
- `--working` uses `git diff --patch`.
- `--staged` uses `git diff --cached --patch`.
- `--dirty` uses `git diff --patch HEAD`.
- The UI supports split/unified diffs, wrapping, line numbers, file tree navigation, raw diff download, basic stats, and UI-local reviews.

## GitHub pull requests

Supported GitHub Targets are public pull request URLs:

```text
https://github.com/OWNER/REPO/pull/123
https://github.com/OWNER/REPO/pull/123/files
https://github.com/OWNER/REPO/pull/123/commits
```

GitHub PR support intentionally excludes private repositories, authenticated requests, GitHub Enterprise, commit URLs, compare URLs, branch/blob URLs, and GitHub review/comment syncing. GitHub PRs are fetched once by the local server and cached for the life of the yadiff process; browser reloads reuse the captured PR diff.

## Future improvement

If huge local diffs become slow, add streaming command output and/or parse patches in a browser worker. GitHub PR fetching already exposes server-side download progress, but browser parsing still happens client-side.

## License

This project is licensed under [MIT](./LICENSE).

It depends on [`@pierre/diffs`](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs) and [`@pierre/trees`](https://github.com/pierrecomputer/pierre/tree/main/packages/trees), which are licensed under [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) by Pierre Computer Company. These are installed as separate npm dependencies and are not bundled in this package. 
