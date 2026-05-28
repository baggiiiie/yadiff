import { runCommand, runCommandSync, trySync } from './run.js';

/**
 * @param {string} repo
 * @param {string[]} args
 */
function runJjSync(repo, args) {
  return runCommandSync('jj', ['--no-pager', '--color', 'never', ...args], repo);
}

/**
 * @param {string} repo
 * @param {string[]} args
 */
function runJj(repo, args) {
  return runCommand('jj', ['--no-pager', '--color', 'never', ...args], repo);
}

/**
 * Detect if a ref looks like a jj revset.
 */
export function isLikelyJjRevset(ref) {
  if (ref == null) return false;
  return ref === '@'
    || ref.startsWith('@')
    || ref.includes('::')
    || /[|&~]/.test(ref)
    || /\b(?:all|author|bookmarks|children|connected|conflicts|description|destination|empty|file|git_head|heads|immutable|latest|mine|mutable|none|parents|present|remote_bookmarks|root|tags|trunk|visible|working_copies)\s*\(/.test(ref);
}

/**
 * Find the jj root at or above the given path, or undefined.
 */
export function findJjRoot(repo) {
  return trySync(() => runJjSync(repo, ['root']));
}

/**
 * Create a jj-backed target object.
 *
 * @param {{ target?: string, mode?: string }} args
 * @param {string} repoRoot
 */
export function createJjTarget(args, repoRoot) {
  const commits = resolveJjCommits(repoRoot, args);

  return {
    kind: 'jj',
    repoRoot,

    getPatch() {
      return runJj(repoRoot, ['diff', '--git', '-r', args.target ?? '@']);
    },

    getCommits() {
      return commits;
    },

    getCommitPatch(commitId) {
      return runJj(repoRoot, ['diff', '--git', '-r', commitId]);
    },

    getHead() {
      return trySync(() => runJjSync(repoRoot, ['log', '-r', '@', '--no-graph', '-T', 'commit_id.short()'])) ?? 'unknown';
    },
  };
}

function resolveJjCommits(repoRoot, args) {
  if (args.mode != null) return [];
  const target = args.target ?? '@';

  const logOutput = trySync(() => runJjSync(repoRoot, [
    'log', '-r', target, '--no-graph',
    '-T', 'commit_id ++ "\t" ++ description.first_line() ++ "\n"',
  ]));
  if (!logOutput) return [];

  const lines = logOutput.split('\n').filter(Boolean);
  if (lines.length <= 1) return [];

  return lines.reverse().map((line) => {
    const [id, message] = line.split('\t');
    return { id, shortId: id.slice(0, 7), message: message ?? '' };
  });
}
