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
 * Create a git-backed target object.
 *
 * @param {{ target?: string, mode?: string }} args
 * @param {string} repoRoot
 */
export function createGitTarget(args, repoRoot) {
  const commits = resolveGitCommits(repoRoot, args);

  return {
    kind: 'git',
    repoRoot,

    getPatch() {
      return runGit(repoRoot, getGitPatchArgs(args));
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
  };
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
