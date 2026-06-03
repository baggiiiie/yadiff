# Releasing & dev builds

This project follows the standard npm prerelease convention.

- Between releases, `package.json` `version` always ends in `-dev.N` (e.g. `0.0.3-dev.0`).
- A release is a single commit that drops the `-dev.N` suffix, publishes to npm, then bumps to the next `-dev.0`.
- `--version` reads straight from `package.json`, so whatever is installed reports its real version with no heuristics.

## Versioning model

```text
╭──────────────────╮   bump      ╭──────────────────╮   release    ╭──────────────────╮   bump      ╭──────────────────╮
│ 0.0.2 (released) │ ──────────▶ │ 0.0.3-dev.0      │ ──────────▶  │ 0.0.3 (released) │ ──────────▶ │ 0.0.4-dev.0      │
╰──────────────────╯             │ (on main)        │              ╰──────────────────╯             │ (on main)        │
                                 ╰──────────────────╯                                               ╰──────────────────╯
```

npm's semver treats `0.0.3-dev.0 < 0.0.3`, and prerelease versions are excluded from `^`/`~` ranges by default, so registry users on a normal install never accidentally get a dev build.

## Cutting a release

From a clean `main` checkout:

```bash
# 1. drop the -dev suffix and create a git tag
npm version patch        # or: minor / major
                         # e.g. 0.0.3-dev.0 -> 0.0.3, creates tag v0.0.3

# 2. publish to npm (runs `prepack` -> `npm run build` automatically)
npm publish

# 3. push the release commit and tag
git push --follow-tags

# 4. bump to the next dev version
npm version 0.0.4-dev.0 -m "chore: bump to %s"
git push
```

Notes:
- `npm version` refuses to run if the working tree is dirty — commit or stash first.
- `npm publish` honours `publishConfig.access: public` in `package.json`, so the scoped package goes out as public.
- Sanity-check with `npm pack --dry-run` before publishing if you've touched `files` or build output.

## Using a dev build globally on your machine

There are two ways to get `yadiff` on your `PATH` pointing at unreleased code.

### `npm link` — live, recommended

Symlinks the global `yadiff` binary to this checkout. Code changes are picked up on the next invocation (re-run `npm run build` after frontend edits).

```bash
npm install
npm run build
npm link
```

Verify:

```bash
yadiff --version
# 0.0.3-dev.0     <- the -dev.N suffix tells you it's an unreleased build
which yadiff      # symlink into your npm global prefix, target inside this repo
```

To undo:

```bash
npm unlink -g @baggiiiie/yadiff
```

### `npm install -g .` — snapshot

Packs and installs the current directory globally. No live link — re-run after every change.

```bash
npm install -g .
```

`prepack` runs `npm run build` automatically, so `dist/` is built as part of the install.

