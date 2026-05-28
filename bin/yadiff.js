#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { createServer as createViteServer } from 'vite';

import { createTarget } from '../lib/target/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function printUsage() {
  console.log(`Usage: yadiff <git-ref-or-range-or-jj-revset-or-github-pr-url> [options]
       yadiff --working [options]
       yadiff --staged [options]
       yadiff --dirty [options]

Examples:
  yadiff abc123
  yadiff main..feature
  yadiff main...HEAD --repo ../my-repo
  yadiff @ --repo ../some-jj-repo
  yadiff 'mine() & mutable()' --vcs jj
  yadiff https://github.com/oven-sh/bun/pull/30412
  yadiff --working
  yadiff --staged
  yadiff --dirty

Options:
  --working          Show unstaged tracked-file changes (git diff), or jj @ if no git repo exists
  --staged           Show staged changes (git diff --cached; git only)
  --dirty            Show staged + unstaged tracked-file changes (git diff HEAD), or jj @ if no git repo exists
  --repo <path>      Repository/workspace path, including subdirectories (default: current directory; ignored for GitHub PR URLs)
  --vcs <auto|git|jj> Select local VCS backend (default: auto; not valid for GitHub PR URLs)
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
      args.portExplicit = true;
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
    throw new Error('Pass either a target URL/ref/range/revset or one of --working, --staged, --dirty, not both.');
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

function getDisplayTarget(args) {
  if (args.mode === 'working') return '--working';
  if (args.mode === 'staged') return '--staged';
  if (args.mode === 'dirty') return '--dirty';
  return args.target;
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

  const target = createTarget(args);
  const displayTarget = target.target ?? getDisplayTarget(args);
  const repositoryName = target.repositoryName ?? target.repoRoot.split('/').filter(Boolean).at(-1) ?? target.repoRoot;

  const app = express();

  app.get('/api/diff/status', (_req, res) => {
    try {
      res.json(target.getStatus?.() ?? { status: 'ready', source: target.source });
    } catch (error) {
      res.status(500).json({ status: 'error', source: target.source, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/diff', async (_req, res) => {
    try {
      const status = target.getStatus?.() ?? { status: 'ready', source: target.source };
      if (status.status === 'fetching') {
        res.status(202).json(status);
        return;
      }
      if (status.status === 'error') {
        res.status(500).json(status);
        return;
      }

      res.json({
        status: 'ready',
        target: displayTarget,
        repositoryName,
        repoRoot: target.repoRoot,
        source: target.source,
        head: target.getHead(),
        patchBytes: status.patchBytes,
        patchUrl: '/api/raw.diff',
        commits: target.getCommits().map(({ id, shortId, message }) => ({ id, shortId, message })),
      });
    } catch (error) {
      res.status(500).json({ status: 'error', source: target.source, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/diff/:commitId', async (req, res) => {
    try {
      const patch = await target.getCommitPatch(req.params.commitId);
      res.json({ patch, patchBytes: Buffer.byteLength(patch) });
    } catch (error) {
      res.status(target.source === 'github' ? 400 : 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/raw.diff', async (_req, res) => {
    try {
      const patch = await target.getPatch();
      res.type('text/plain').set('Content-Length', String(Buffer.byteLength(patch))).send(patch);
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
  const boundPort = await listenWithFallback(server, args.port, args.host, args.portExplicit);
  const url = `http://${args.host}:${boundPort}/`;
  console.log(`yadiff: ${url}`);
  if (target.source === 'github') {
    console.log(`Fetching GitHub PR diff: ${displayTarget}`);
    target.getPatch()
      .then((patch) => console.log(`Fetched ${formatBytes(Buffer.byteLength(patch))} from GitHub.`))
      .catch((error) => console.error(error instanceof Error ? error.message : String(error)));
  }
  console.log(`Repo: ${repositoryName}`);
  console.log(`Source: ${formatSource(target.source)}`);
  console.log(`Target: ${displayTarget}`);

  if (args.open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const openerArgs = process.platform === 'win32' ? ['/c', 'start', url] : [url];
    spawn(opener, openerArgs, { detached: true, stdio: 'ignore' }).unref();
  }
}

function listenWithFallback(server, preferredPort, host, portExplicit) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (err) => {
      if (err && err.code === 'EADDRINUSE' && !portExplicit) {
        server.removeListener('error', onError);
        console.warn(`yadiff: port ${preferredPort} is busy, picking a free one...`);
        server.listen(0, host, () => {
          const addr = server.address();
          resolveListen(addr && typeof addr === 'object' ? addr.port : preferredPort);
        });
        server.once('error', rejectListen);
        return;
      }
      rejectListen(err);
    };
    server.once('error', onError);
    server.listen(preferredPort, host, () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolveListen(addr && typeof addr === 'object' ? addr.port : preferredPort);
    });
  });
}

function formatSource(source) {
  if (source === 'github') return 'GitHub';
  return source;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 1 : 2)} KB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} MB`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
