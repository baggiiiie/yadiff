const GITHUB_DIFF_TIMEOUT_MS = 60_000;
const GITHUB_MAX_PATCH_BYTES = 100 * 1024 * 1024;

/**
 * Detect whether the target is an HTTP(S) URL.
 *
 * @param {string | undefined} target
 */
export function isHttpUrl(target) {
  if (target == null) return false;
  try {
    const url = new URL(target);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Detect URL-looking remote targets before local git/jj interpretation.
 *
 * @param {string | undefined} target
 */
export function isRemoteTargetLike(target) {
  return isHttpUrl(target) || /^\/?(?:www\.)?github\.com\//.test(target ?? '');
}

/**
 * Parse and canonicalize a public github.com pull request URL.
 *
 * @param {string | undefined} target
 * @returns {{ owner: string, repo: string, number: string, canonicalUrl: string, repoUrl: string, diffUrl: string, repositoryName: string } | undefined}
 */
export function parseGitHubPullRequestUrl(target) {
  if (target == null) return undefined;

  let url;
  try {
    url = new URL(target);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return undefined;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const [owner, repo, pullSegment, number] = segments;
  if (owner == null || repo == null || pullSegment !== 'pull' || number == null || !/^\d+$/.test(number)) {
    return undefined;
  }

  const remainder = segments.slice(4);
  if (remainder.length > 1 || (remainder.length === 1 && !['files', 'commits'].includes(remainder[0]))) {
    return undefined;
  }

  const canonicalUrl = `https://github.com/${owner}/${repo}/pull/${number}`;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  return {
    owner,
    repo,
    number,
    canonicalUrl,
    repoUrl,
    diffUrl: `${canonicalUrl}.diff`,
    repositoryName: `${owner}/${repo}`,
  };
}

/**
 * @param {string | undefined} target
 */
export function isGitHubPullRequestUrl(target) {
  return parseGitHubPullRequestUrl(target) != null;
}

/**
 * Create a GitHub-backed target object. Fetching starts immediately and the
 * patch is cached for the process lifetime.
 *
 * @param {{ target?: string }} args
 */
export function createGitHubPullRequestTarget(args) {
  const pullRequest = parseGitHubPullRequestUrl(args.target);
  if (pullRequest == null) {
    throw new Error('Only public GitHub pull request URLs are supported as remote targets.');
  }

  /** @type {'fetching' | 'ready' | 'error'} */
  let status = 'fetching';
  let bytesDownloaded = 0;
  /** @type {number | undefined} */
  let patchBytes;
  /** @type {string | undefined} */
  let patch;
  /** @type {string | undefined} */
  let error;
  /** @type {unknown} */
  let fetchFailure;

  const patchPromise = fetchPullRequestDiff(pullRequest, (bytes) => {
    bytesDownloaded = bytes;
  }).then((fetchedPatch) => {
    patch = fetchedPatch;
    patchBytes = Buffer.byteLength(fetchedPatch);
    bytesDownloaded = patchBytes;
    status = 'ready';
  }).catch((fetchError) => {
    fetchFailure = fetchError;
    error = fetchError instanceof Error ? fetchError.message : String(fetchError);
    status = 'error';
  });

  return {
    source: 'github',
    repoRoot: pullRequest.repoUrl,
    repositoryName: pullRequest.repositoryName,
    target: pullRequest.canonicalUrl,

    async getPatch() {
      if (patch != null) return patch;
      await patchPromise;
      if (patch != null) return patch;
      throw fetchFailure instanceof Error ? fetchFailure : new Error(error ?? 'Could not fetch GitHub pull request diff.');
    },

    getCommits() {
      return [];
    },

    async getCommitPatch() {
      throw new Error('Commit diffs are not supported for GitHub pull request targets.');
    },

    getHead() {
      return `PR #${pullRequest.number}`;
    },

    getStatus() {
      return {
        status,
        source: 'github',
        bytesDownloaded,
        patchBytes,
        error,
      };
    },
  };
}

async function fetchPullRequestDiff(pullRequest, onProgress) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_DIFF_TIMEOUT_MS);
  try {
    const response = await fetch(pullRequest.diffUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/plain, application/vnd.github.v3.diff',
        'User-Agent': 'yadiff/0.1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Could not fetch GitHub pull request diff (${response.status}): ${pullRequest.diffUrl}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/^text\/(plain|x-diff)\b/i.test(contentType)) {
      throw new Error('GitHub did not return a diff for this public pull request URL.');
    }

    if (response.body == null) {
      const text = await response.text();
      const bytes = Buffer.byteLength(text);
      if (bytes > GITHUB_MAX_PATCH_BYTES) {
        throw new Error(`GitHub pull request diff is too large (${formatBytes(bytes)}). The current limit is ${formatBytes(GITHUB_MAX_PATCH_BYTES)}.`);
      }
      onProgress(bytes);
      return text;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value == null) continue;
      bytes += value.byteLength;
      if (bytes > GITHUB_MAX_PATCH_BYTES) {
        await reader.cancel();
        throw new Error(`GitHub pull request diff is too large (${formatBytes(bytes)}). The current limit is ${formatBytes(GITHUB_MAX_PATCH_BYTES)}.`);
      }
      chunks.push(Buffer.from(value));
      onProgress(bytes);
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } catch (fetchError) {
    if (fetchError?.name === 'AbortError') {
      throw new Error(`Timed out fetching GitHub pull request diff after ${Math.round(GITHUB_DIFF_TIMEOUT_MS / 1000)}s: ${pullRequest.diffUrl}`);
    }
    throw fetchError;
  } finally {
    clearTimeout(timeout);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 1 : 2)} KB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} MB`;
}
