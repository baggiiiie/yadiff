#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { createServer as createViteServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function printUsage() {
  console.log(`Usage: yadiff <git-ref-or-range-or-jj-revset> [options]
       yadiff --working [options]
       yadiff --staged [options]
       yadiff --dirty [options]

Examples:
  yadiff abc123
  yadiff main..feature
  yadiff main...HEAD --repo ../my-repo
  yadiff @ --repo ../my-jj-repo
  yadiff 'mine() & mutable()' --vcs jj
  yadiff --working
  yadiff --staged
  yadiff --dirty

Options:
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
  -h, --help        Show this help
`);
}

function parseArgs(argv) {
  const args = {
    target: undefined,
    mode: undefined,
    repo: process.cwd(),
    port: 5177,
    host: '127.0.0.1',
    open: true,
    vcs: 'auto',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '--working' || arg === '--staged' || arg === '--dirty') {
      if (args.mode != null) {
        throw new Error(`Only one diff mode can be used at a time: ${args.mode} and ${arg}`);
      }
      args.mode = arg.slice(2);
    } else if (arg === '--repo') {
      args.repo = requireValue(argv, ++index, '--repo');
    } else if (arg === '--port') {
      args.port = Number(requireValue(argv, ++index, '--port'));
    } else if (arg === '--host') {
      args.host = requireValue(argv, ++index, '--host');
    } else if (arg === '--vcs') {
      args.vcs = requireChoice(requireValue(argv, ++index, '--vcs'), '--vcs', ['auto', 'git', 'jj']);
    } else if (arg === '--git') {
      args.vcs = 'git';
    } else if (arg === '--jj') {
      args.vcs = 'jj';
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg?.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (args.target == null) {
      args.target = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error('--port must be a positive number');
  }
  if (args.target != null && args.mode != null) {
    throw new Error('Pass either a target (ref/range/revset) or one of --working, --staged, --dirty, not both.');
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value == null || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requireChoice(value, flag, choices) {
  if (!choices.includes(value)) {
    throw new Error(`${flag} must be one of: ${choices.join(', ')}`);
  }
  return value;
}

function runGitSync(repo, args) {
  return runCommandSync('git', args, repo);
}

function runGit(repo, args) {
  return runCommand('git', args, repo);
}

function runJjSync(repo, args) {
  return runCommandSync('jj', ['--no-pager', '--color', 'never', ...args], repo);
}

function runJj(repo, args) {
  return runCommand('jj', ['--no-pager', '--color', 'never', ...args], repo);
}

function runCommandSync(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

function runCommand(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${command} ${args.join(' ')} failed (${code})`));
    });
  });
}

function trySync(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function resolveRepositories(repo) {
  const gitRoot = trySync(() => runGitSync(repo, ['rev-parse', '--show-toplevel']));
  const jjRoot = trySync(() => runJjSync(repo, ['root']));
  return { gitRoot, jjRoot };
}

function selectBackend(args, repositories) {
  const { gitRoot, jjRoot } = repositories;
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

function isGitRevision(repo, ref) {
  if (ref == null) {
    return false;
  }
  const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repo,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function isLikelyGitRange(ref) {
  return ref?.includes('..') === true;
}

function isLikelyJjRevset(ref) {
  if (ref == null) {
    return false;
  }
  return ref === '@'
    || ref.startsWith('@')
    || ref.includes('::')
    || /[|&~]/.test(ref)
    || /\b(?:all|author|bookmarks|children|connected|conflicts|description|destination|empty|file|git_head|heads|immutable|latest|mine|mutable|none|parents|present|remote_bookmarks|root|tags|trunk|visible|working_copies)\s*\(/.test(ref);
}

function getGitPatchArgs(args) {
  const common = ['--find-renames', '--find-copies', '--no-ext-diff', '--no-color'];
  if (args.mode === 'working') {
    return ['diff', ...common, '--patch', '--'];
  }
  if (args.mode === 'staged') {
    return ['diff', ...common, '--cached', '--patch', '--'];
  }
  if (args.mode === 'dirty') {
    return ['diff', ...common, '--patch', 'HEAD', '--'];
  }
  if (args.target.includes('..')) {
    return ['diff', ...common, '--patch', args.target, '--'];
  }
  return ['show', ...common, '--format=fuller', '--patch', args.target, '--'];
}

function getJjPatchArgs(args) {
  if (args.mode === 'staged') {
    throw new Error('--staged is only supported for git repositories.');
  }
  return ['diff', '--git', '-r', args.target ?? '@'];
}

function getCommits(backend, args) {
  if (args.mode != null) {
    return [];
  }
  if (backend.kind === 'git') {
    return getGitCommits(backend.repoRoot, args);
  }
  return getJjCommits(backend.repoRoot, args);
}

function getGitCommits(repoRoot, args) {
  const target = args.target;
  if (target.includes('..')) {
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
  // Single ref — no multi-commit navigation needed
  return [];
}

function getJjCommits(repoRoot, args) {
  const target = args.target ?? '@';
  // Check if the revset resolves to multiple revisions
  const logOutput = trySync(() => runJjSync(repoRoot, [
    'log', '-r', target, '--no-graph',
    '-T', 'commit_id ++ "\t" ++ description.first_line() ++ "\n"',
  ]));
  if (!logOutput) return [];
  const lines = logOutput.split('\n').filter(Boolean);
  if (lines.length <= 1) return [];
  // Multiple revisions — return them in chronological order (reverse jj's default)
  return lines.reverse().map((line) => {
    const [id, message] = line.split('\t');
    return { id, shortId: id.slice(0, 7), message: message ?? '' };
  });
}

async function getCommitPatch(backend, commitId) {
  if (backend.kind === 'git') {
    const common = ['--find-renames', '--find-copies', '--no-ext-diff', '--no-color'];
    return runGit(backend.repoRoot, ['show', ...common, '--format=', '--patch', commitId, '--']);
  }
  return runJj(backend.repoRoot, ['diff', '--git', '-r', commitId]);
}

function getDisplayTarget(args) {
  if (args.mode === 'working') {
    return '--working';
  }
  if (args.mode === 'staged') {
    return '--staged';
  }
  if (args.mode === 'dirty') {
    return '--dirty';
  }
  return args.target;
}

function getPatch(backend, args) {
  if (backend.kind === 'git') {
    return runGit(backend.repoRoot, getGitPatchArgs(args));
  }
  return runJj(backend.repoRoot, getJjPatchArgs(args));
}

function getHead(backend) {
  if (backend.kind === 'git') {
    return trySync(() => runGitSync(backend.repoRoot, ['rev-parse', '--short', 'HEAD'])) ?? 'unknown';
  }
  return trySync(() => runJjSync(backend.repoRoot, ['log', '-r', '@', '--no-graph', '-T', 'commit_id.short()'])) ?? 'unknown';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (args.target == null && args.mode == null) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const displayTarget = getDisplayTarget(args);
  const backend = selectBackend(args, resolveRepositories(args.repo));
  const repositoryName = backend.repoRoot.split('/').filter(Boolean).at(-1) ?? backend.repoRoot;

  const commits = getCommits(backend, args);

  const app = express();
  app.get('/api/diff', async (_req, res) => {
    try {
      const patch = await getPatch(backend, args);
      const head = getHead(backend);
      res.json({
        target: displayTarget,
        repositoryName,
        repoRoot: backend.repoRoot,
        vcs: backend.kind,
        head,
        patch,
        patchBytes: Buffer.byteLength(patch),
        commits: commits.map(({ id, shortId, message }) => ({ id, shortId, message })),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/diff/:commitId', async (req, res) => {
    try {
      const patch = await getCommitPatch(backend, req.params.commitId);
      res.json({ patch, patchBytes: Buffer.byteLength(patch) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/raw.diff', async (_req, res) => {
    try {
      const patch = await getPatch(backend, args);
      res.type('text/plain').send(patch);
    } catch (error) {
      res.status(500).type('text/plain').send(error instanceof Error ? error.message : String(error));
    }
  });

  const vite = await createViteServer({
    root: projectRoot,
    appType: 'spa',
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);

  const server = createServer(app);
  await new Promise((resolvePromise) => server.listen(args.port, args.host, resolvePromise));
  const url = `http://${args.host}:${args.port}/`;
  console.log(`yadiff: ${url}`);
  console.log(`Repo: ${backend.repoRoot}`);
  console.log(`VCS:  ${backend.kind}`);
  console.log(`Target: ${displayTarget}`);

  if (args.open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const openerArgs = process.platform === 'win32' ? ['/c', 'start', url] : [url];
    spawn(opener, openerArgs, { detached: true, stdio: 'ignore' }).unref();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
