import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { runCommand, runCommandSync, runProbe, trySync } from './run.js';

/**
 * @param {string} repo
 * @param {string[]} args
 */
function runGitSync(repo, args) {
  return runCommandSync('git', args, repo);
}

/**
 * @param {string} repo
 * @param {string[]} args
 */
function runGit(repo, args) {
  return runCommand('git', args, repo);
}

/**
 * Check if a ref resolves to a valid git commit.
 */
export function isGitRevision(repo, ref) {
  if (ref == null) return false;
  return runProbe('git', ['rev-parse', '--verify', `${ref}^{commit}`], repo);
}

/**
 * Detect if a ref looks like a git range (contains `..`).
 */
export function isLikelyGitRange(ref) {
  return ref?.includes('..') === true;
}

/**
 * Find the git root at or above the given path, or undefined.
 */
export function findGitRoot(repo) {
  return trySync(() => runGitSync(repo, ['rev-parse', '--show-toplevel']));
}

const COMMON_DIFF_FLAGS = ['--find-renames', '--find-copies', '--no-ext-diff', '--no-color'];

/**
 * How many untracked files to diff against /dev/null at once. Each one needs its own
 * `git diff --no-index` process, so large untracked sets are handled in batches.
 */
const UNTRACKED_PATCH_CONCURRENCY = 16;

function getGitPatchArgs(args) {
  if (args.mode === 'working') {
    return ['diff', ...COMMON_DIFF_FLAGS, '--patch', '--'];
  }
  if (args.mode === 'staged') {
    return ['diff', ...COMMON_DIFF_FLAGS, '--cached', '--patch', '--'];
  }
  if (args.mode === 'dirty') {
    return ['diff', ...COMMON_DIFF_FLAGS, '--patch', 'HEAD', '--'];
  }
  if (args.target.includes('..')) {
    return ['diff', ...COMMON_DIFF_FLAGS, '--patch', args.target, '--'];
  }
  return ['show', ...COMMON_DIFF_FLAGS, '--format=fuller', '--patch', args.target, '--'];
}

/**
 * Build the patch for a working-tree mode. Untracked files never appear in `git diff`,
 * so they are diffed separately against /dev/null and appended as new-file sections.
 * Only working (`git diff`) and dirty (`git diff HEAD`) describe the working tree;
 * staged and revision targets cover tracked history only.
 */
async function getGitPatch(repoRoot, args) {
  if (args.mode !== 'working' && args.mode !== 'dirty') {
    return runGit(repoRoot, getGitPatchArgs(args));
  }

  const [trackedPatch, untrackedPatch] = await Promise.all([
    runGit(repoRoot, getGitPatchArgs(args)),
    getUntrackedPatch(repoRoot),
  ]);
  return trackedPatch + untrackedPatch;
}

/**
 * Produce patch sections for every untracked, non-ignored file. `--exclude-standard`
 * honors .gitignore, so ignored files stay out of the patch.
 */
async function getUntrackedPatch(repoRoot) {
  const listing = await runGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  const paths = listing.split('\0').filter((path) => path !== '');
  if (paths.length === 0) {
    return '';
  }

  const chunks = [];
  for (let index = 0; index < paths.length; index += UNTRACKED_PATCH_CONCURRENCY) {
    const batch = paths.slice(index, index + UNTRACKED_PATCH_CONCURRENCY);
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- Batches must complete in order so patch sections stay deterministic.
    chunks.push(...await Promise.all(batch.map((path) => readUntrackedDiff(repoRoot, path))));
  }

  return chunks.filter((chunk) => chunk != null).join('');
}

async function readUntrackedDiff(repoRoot, path) {
  try {
    // `git diff --no-index` exits 1 when the files differ, which is the expected case here.
    return await runCommand(
      'git',
      ['diff', '--no-index', ...COMMON_DIFF_FLAGS, '--', '/dev/null', path],
      repoRoot,
      { allowedExitCodes: [0, 1] }
    );
  } catch {
    // A path that vanished or cannot be read should not fail the whole diff.
    return null;
  }
}

/**
 * Create a git-backed target object.
 *
 * @param {{ target?: string, mode?: string }} args
 * @param {string} repoRoot
 */
export function createGitTarget(args, repoRoot) {
  const commits = resolveGitCommits(repoRoot, args);

  return {
    source: 'git',
    repoRoot,

    getPatch() {
      return getGitPatch(repoRoot, args);
    },

    getCommits() {
      return commits;
    },

    getCommitPatch(commitId) {
      return runGit(repoRoot, ['show', ...COMMON_DIFF_FLAGS, '--format=', '--patch', commitId, '--']);
    },

    getHead() {
      return trySync(() => runGitSync(repoRoot, ['rev-parse', '--short', 'HEAD'])) ?? 'unknown';
    },

    getStatus() {
      return { status: 'ready', source: 'git' };
    },

    getFileContents(file) {
      return getGitFileContents(repoRoot, file);
    },
  };
}

async function getGitFileContents(repoRoot, file) {
  const oldPath = file.prevName ?? file.name;
  const newPath = file.name;
  const oldContents = file.type === 'new'
    ? ''
    : await readBlobOrWorkingFile(repoRoot, file.prevObjectId, oldPath, false);
  const newContents = file.type === 'deleted'
    ? ''
    : await readBlobOrWorkingFile(repoRoot, file.newObjectId, newPath, true);

  if (oldContents == null || newContents == null) {
    return undefined;
  }

  return {
    oldFile: {
      name: oldPath,
      contents: oldContents,
      cacheKey: file.prevObjectId != null && !isZeroObjectId(file.prevObjectId) ? file.prevObjectId : `working-old:${oldPath}`,
    },
    newFile: {
      name: newPath,
      contents: newContents,
      cacheKey: file.newObjectId != null && !isZeroObjectId(file.newObjectId) ? file.newObjectId : `working-new:${newPath}`,
    },
  };
}

async function readBlobOrWorkingFile(repoRoot, objectId, path, allowWorkingTreeFallback) {
  const blobContents = await readGitBlob(repoRoot, objectId);
  if (blobContents != null) {
    return blobContents;
  }
  if (!allowWorkingTreeFallback) {
    return undefined;
  }
  return readWorkingTreeFile(repoRoot, path);
}

async function readGitBlob(repoRoot, objectId) {
  if (objectId == null || isZeroObjectId(objectId)) {
    return undefined;
  }
  try {
    return await runGit(repoRoot, ['cat-file', '-p', objectId]);
  } catch {
    return undefined;
  }
}

async function readWorkingTreeFile(repoRoot, path) {
  if (path == null || path === '/dev/null') {
    return undefined;
  }
  const absolutePath = resolve(repoRoot, path);
  const relativePath = relative(repoRoot, absolutePath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return undefined;
  }
  try {
    return await readFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

function isZeroObjectId(objectId) {
  return /^0+$/.test(objectId);
}

function resolveGitCommits(repoRoot, args) {
  if (args.mode != null) return [];
  const target = args.target;
  if (!target?.includes('..')) return [];

  const logOutput = trySync(() => runGitSync(repoRoot, [
    'log', '--reverse', '--format=%H %s', target,
  ]));
  if (!logOutput) return [];

  return logOutput.split('\n').filter(Boolean).map((line) => {
    const spaceIndex = line.indexOf(' ');
    const id = line.slice(0, spaceIndex);
    const message = line.slice(spaceIndex + 1);
    return { id, shortId: id.slice(0, 7), message };
  });
}
