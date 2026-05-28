# yadiff, yet another diff viewer

> Huge shoutout to [pierrecomputer](https://github.com/pierrecomputer/pierre). Inspired by [diffshub](https://diffshub.com/), this tool is only possible thanks to the incredibly beautiful and high-performance diff and tree packages. All credit goes to the team!

A browser diff viewer for local git/jj diffs and GitHub PRs. It uses [pierrecomputer](https://github.com/pierrecomputer/pierre)'s open-source packages:

- [`@pierre/diffs`](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs) for parsing/rendering diffs
- [`@pierre/trees`](https://github.com/pierrecomputer/pierre/tree/main/packages/trees) for the file tree

## Usage

Run directly with `npx`:

```bash
npx yadiff <git-ref-or-range>/<jj-revset>/<github-pr-url>
npx yadiff --working/--staged/--dirty
```

Or install globally:

```bash
npm install -g yadiff
yadiff HEAD
```

The command starts a local server, opens the browser, acquires a diff from the selected source, and serves the patch to the browser.

### Examples:

Git:

```bash
npx yadiff HEAD
npx yadiff main..feature
npx yadiff main...HEAD --repo ../some-repo
npx yadiff --working/--staged/--dirty
```

jj:

```bash
npx yadiff @ --repo ../some-jj-repo
npx yadiff 'mine() & mutable()' --vcs jj
```

GitHub:

```bash
npx yadiff https://github.com/oven-sh/bun/pull/30412
```

## GitHub pull requests

Supported GitHub Targets are public pull request URLs:

```text
https://github.com/OWNER/REPO/pull/123
https://github.com/OWNER/REPO/pull/123/files
https://github.com/OWNER/REPO/pull/123/commits
```

GitHub PR support intentionally excludes private repositories, authenticated requests, GitHub Enterprise, commit URLs, compare URLs, branch/blob URLs, and GitHub review/comment syncing. GitHub PRs are fetched once by the local server and cached for the life of the yadiff process; browser reloads reuse the captured PR diff.

## potential future improvement

- add a button to sync review to github, with `gh` cli?
- copy filename; open file with `$EDITOR`
- support for private repo and enterprise, with `gh` cli
- stdin support

## License

[MIT](./LICENSE).
