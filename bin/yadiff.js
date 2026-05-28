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

  const displayTarget = getDisplayTarget(args);
  const target = createTarget(args);
  const repositoryName = target.repoRoot.split('/').filter(Boolean).at(-1) ?? target.repoRoot;

  const app = express();
  app.get('/api/diff', async (_req, res) => {
    try {
      const patch = await target.getPatch();
      const head = target.getHead();
      res.json({
        target: displayTarget,
        repositoryName,
        repoRoot: target.repoRoot,
        vcs: target.kind,
        head,
        patch,
        patchBytes: Buffer.byteLength(patch),
        commits: target.getCommits().map(({ id, shortId, message }) => ({ id, shortId, message })),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/diff/:commitId', async (req, res) => {
    try {
      const patch = await target.getCommitPatch(req.params.commitId);
      res.json({ patch, patchBytes: Buffer.byteLength(patch) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/raw.diff', async (_req, res) => {
    try {
      const patch = await target.getPatch();
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
  console.log(`Repo: ${target.repoRoot}`);
  console.log(`VCS:  ${target.kind}`);
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
