# Local DiffsHub

A small local browser diff viewer inspired by DiffsHub. It uses Pierre's open-source packages:

- `@pierre/diffs` for parsing/rendering unified git patches
- `@pierre/trees` for the changed-file tree

## Usage

```bash
npm install
npm run dev -- <git-ref-or-range-or-jj-revset>
# or one local mode:
npm run dev -- --working
npm run dev -- --staged
npm run dev -- --dirty
```

Examples:

```bash
npm run dev -- HEAD
npm run dev -- abc123
npm run dev -- main..feature
npm run dev -- main...HEAD --repo ../some-repo
npm run dev -- @ --repo ../some-jj-repo
npm run dev -- 'mine() & mutable()' --vcs jj
npm run dev -- --working
npm run dev -- --staged
npm run dev -- --dirty
```

Or invoke the bin directly:

```bash
./bin/diffshub-local.js HEAD --repo /path/to/repo
```

The command starts a local Vite/Express server, opens the browser, runs git or jj in the target repo, and serves the patch to the browser.

## Options

```text
--working          Show unstaged tracked-file changes (git diff), or jj @ if no git repo exists
--staged           Show staged changes (git diff --cached; git only)
--dirty            Show staged + unstaged tracked-file changes (git diff HEAD), or jj @ if no git repo exists
--repo <path>      Repository/workspace path, including subdirectories (default: current directory)
--vcs <auto|git|jj> Select backend (default: auto)
--git              Shortcut for --vcs git
--jj               Shortcut for --vcs jj
--port <number>   Port to listen on (default: 5177)
--host <host>     Host to bind (default: 127.0.0.1)
--no-open         Do not open the browser automatically
```

## Current behavior

- In git repositories, a single ref like `abc123` uses `git show --patch abc123`. This is intentionally kept as normal Git semantics for now; merge commits can be handled with explicit ranges if needed.
- In git repositories, a range containing `..` or `...` uses `git diff --patch <range>`.
- In jj repositories, jj-looking revsets such as `@`, `@-`, `A::B`, or `mine() & mutable()` use `jj diff --git -r <revset>`.
- Auto mode prefers git for normal git refs/ranges and falls back to jj when the argument is not a git revision. Use `--jj` or `--vcs jj` to force jj.
- `--working` uses `git diff --patch`.
- `--staged` uses `git diff --cached --patch`.
- `--dirty` uses `git diff --patch HEAD`.
- The UI supports split/unified diffs, wrapping, line numbers, file tree navigation, raw diff download, and basic stats.

## Future improvement

For now `/api/diff` returns one JSON payload. If huge diffs become slow, add a streaming endpoint that parses and appends file diffs incrementally like DiffsHub.
