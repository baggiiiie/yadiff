import { createGitTarget, findGitRoot, isGitRevision, isLikelyGitRange } from './git-adapter.js';
import { createGitHubPullRequestTarget, isRemoteTargetLike, parseGitHubPullRequestUrl } from './github-adapter.js';
import { createJjTarget, findJjRoot, isLikelyJjRevset } from './jj-adapter.js';

/**
 * Resolve CLI arguments into a Target object that knows how to produce patches.
 *
 * @param {{ target?: string, mode?: string, repo: string, vcs: 'auto' | 'git' | 'jj' }} args
 * @returns {{ source: 'git' | 'jj' | 'github', repoRoot: string, repositoryName?: string, target?: string, getPatch: () => Promise<string>, getCommits: () => Commit[], getCommitPatch: (id: string) => Promise<string>, getHead: () => string, getStatus?: () => object }}
 */
export function createTarget(args) {
  if (isRemoteTargetLike(args.target)) {
    const githubPullRequest = parseGitHubPullRequestUrl(args.target);
    if (githubPullRequest == null) {
      throw new Error('Only public GitHub pull request URLs are supported as remote targets.');
    }
    if (args.vcs !== 'auto') {
      throw new Error('--vcs cannot be used with a GitHub pull request URL.');
    }
    return createGitHubPullRequestTarget(args);
  }

  const gitRoot = findGitRoot(args.repo);
  const jjRoot = findJjRoot(args.repo);
  const { source, repoRoot } = selectBackend(args, gitRoot, jjRoot);

  if (source === 'git') {
    return createGitTarget(args, repoRoot);
  }
  return createJjTarget(args, repoRoot);
}

function selectBackend(args, gitRoot, jjRoot) {
  if (args.vcs === 'git') {
    if (gitRoot == null) {
      throw new Error(`No git repository found at or above ${args.repo}`);
    }
    return { source: 'git', repoRoot: gitRoot };
  }

  if (args.vcs === 'jj') {
    if (jjRoot == null) {
      throw new Error(`No jj repository found at or above ${args.repo}`);
    }
    if (args.mode === 'staged') {
      throw new Error('--staged is only supported for git repositories.');
    }
    return { source: 'jj', repoRoot: jjRoot };
  }

  // Auto mode
  if (args.mode != null) {
    if (gitRoot != null) {
      return { source: 'git', repoRoot: gitRoot };
    }
    if (jjRoot != null && args.mode !== 'staged') {
      return { source: 'jj', repoRoot: jjRoot };
    }
    throw new Error(`No git repository found at or above ${args.repo}`);
  }

  if (jjRoot != null && isLikelyJjRevset(args.target)) {
    return { source: 'jj', repoRoot: jjRoot };
  }
  if (gitRoot != null && isLikelyGitRange(args.target)) {
    return { source: 'git', repoRoot: gitRoot };
  }
  if (gitRoot != null && isGitRevision(gitRoot, args.target)) {
    return { source: 'git', repoRoot: gitRoot };
  }
  if (jjRoot != null) {
    return { source: 'jj', repoRoot: jjRoot };
  }
  if (gitRoot != null) {
    return { source: 'git', repoRoot: gitRoot };
  }
  throw new Error(`No git or jj repository found at or above ${args.repo}`);
}
