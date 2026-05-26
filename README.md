# Local DiffsHub

A small local browser diff viewer inspired by DiffsHub. It uses Pierre's open-source packages:

- `@pierre/diffs` for parsing/rendering unified git patches
- `@pierre/trees` for the changed-file tree

## Usage

```bash
npm install
npm run dev -- <git-ref-or-range>
```

Examples:

```bash
npm run dev -- HEAD
npm run dev -- abc123
npm run dev -- main..feature
npm run dev -- main...HEAD --repo ../some-repo
```

Or invoke the bin directly:

```bash
./bin/diffshub-local.js HEAD --repo /path/to/repo
```

The command starts a local Vite/Express server, opens the browser, runs git in the target repo, and serves the patch to the browser.

## Options

```text
--repo <path>       Git repository to inspect (default: current directory)
--port <number>    Port to listen on (default: 5177)
--host <host>      Host to bind (default: 127.0.0.1)
--no-open          Do not open the browser automatically
```

## Current behavior

- A single ref like `abc123` uses `git show --patch abc123`.
- A range containing `..` or `...` uses `git diff --patch <range>`.
- The UI supports split/unified diffs, wrapping, line numbers, file tree navigation, raw diff download, and basic stats.

## Follow-ups worth deciding

- Whether `abc123` should always mean `abc123^..abc123`, or whether `git show` semantics are okay for merge commits.
- Whether to add working-tree modes like `--staged` and `--working`.
- Whether to stream huge diffs file-by-file like DiffsHub does, instead of returning one JSON payload.
