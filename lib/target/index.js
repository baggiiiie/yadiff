import { createGitTarget, findGitRoot, isGitRevision, isLikelyGitRange } from './git-adapter.js';
import { createJjTarget, findJjRoot, isLikelyJjRevset } from './jj-adapter.js';

/**
 * Resolve CLI arguments into a Target object that knows how to produce patches.
 *
 * @param {{ target?: string, mode?: string, repo: string, vcs: 'auto' | 'git' | 'jj' }} args
 * @returns {{ kind: 'git' | 'jj', repoRoot: string, getPatch: () => Promise<string>, getCommits: () => Commit[], getCommitPatch: (id: string) => Promise<string>, getHead: () => string }}
 */
export function createTarget(args) {
  const gitRoot = findGitRoot(args.repo);
  const jjRoot = findJjRoot(args.repo);
  const { kind, repoRoot } = selectBackend(args, gitRoot, jjRoot);

  if (kind === 'git') {
    return createGitTarget(args, repoRoot);
  }
  return createJjTarget(args, repoRoot);
}

function selectBackend(args, gitRoot, jjRoot) {
  if (args.vcs === 'git') {
    if (gitRoot == null) {
      throw new Error(`No git repository found at or above ${args.repo}`);
    }
    return { kind: 'git', repoRoot: gitRoot };
  }

  if (args.vcs === 'jj') {
    if (jjRoot == null) {
      throw new Error(`No jj repository found at or above ${args.repo}`);
    }
    if (args.mode === 'staged') {
      throw new Error('--staged is only supported for git repositories.');
    }
    return { kind: 'jj', repoRoot: jjRoot };
  }

  // Auto mode
  if (args.mode != null) {
    if (gitRoot != null) {
      return { kind: 'git', repoRoot: gitRoot };
    }
    if (jjRoot != null && args.mode !== 'staged') {
      return { kind: 'jj', repoRoot: jjRoot };
    }
    throw new Error(`No git repository found at or above ${args.repo}`);
  }

  if (jjRoot != null && isLikelyJjRevset(args.target)) {
    return { kind: 'jj', repoRoot: jjRoot };
  }
  if (gitRoot != null && isLikelyGitRange(args.target)) {
    return { kind: 'git', repoRoot: gitRoot };
  }
  if (gitRoot != null && isGitRevision(gitRoot, args.target)) {
    return { kind: 'git', repoRoot: gitRoot };
  }
  if (jjRoot != null) {
    return { kind: 'jj', repoRoot: jjRoot };
  }
  if (gitRoot != null) {
    return { kind: 'git', repoRoot: gitRoot };
  }
  throw new Error(`No git or jj repository found at or above ${args.repo}`);
}
