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
  console.log(`Usage: diffshub-local <git-ref-or-range> [options]
       diffshub-local --working [options]
       diffshub-local --staged [options]
       diffshub-local --dirty [options]

Examples:
  diffshub-local abc123
  diffshub-local main..feature
  diffshub-local main...HEAD --repo ../my-repo
  diffshub-local --working
  diffshub-local --staged
  diffshub-local --dirty

Options:
  --working          Show unstaged tracked-file changes (git diff)
  --staged           Show staged changes (git diff --cached)
  --dirty            Show staged + unstaged tracked-file changes (git diff HEAD)
  --repo <path>      Git repository to inspect (default: current directory)
  --port <number>   Port to listen on (default: 5177)
  --host <host>     Host to bind (default: 127.0.0.1)
  --no-open         Do not open the browser automatically
  -h, --help        Show this help
`);
}

function parseArgs(argv) {
  const args = {
    ref: undefined,
    mode: undefined,
    repo: process.cwd(),
    port: 5177,
    host: '127.0.0.1',
    open: true,
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
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg?.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (args.ref == null) {
      args.ref = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error('--port must be a positive number');
  }
  if (args.ref != null && args.mode != null) {
    throw new Error('Pass either a git ref/range or one of --working, --staged, --dirty, not both.');
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

function runGitSync(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

function runGit(repo, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', repo, ...args], {
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
      reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `git ${args.join(' ')} failed (${code})`));
    });
  });
}

function getPatchArgs(args) {
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
  if (args.ref.includes('..')) {
    return ['diff', ...common, '--patch', args.ref, '--'];
  }
  return ['show', ...common, '--format=fuller', '--patch', args.ref, '--'];
}

function getDisplayRef(args) {
  if (args.mode === 'working') {
    return '--working';
  }
  if (args.mode === 'staged') {
    return '--staged';
  }
  if (args.mode === 'dirty') {
    return '--dirty';
  }
  return args.ref;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (args.ref == null && args.mode == null) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const displayRef = getDisplayRef(args);
  const repoRoot = runGitSync(args.repo, ['rev-parse', '--show-toplevel']);
  const repositoryName = repoRoot.split('/').filter(Boolean).at(-1) ?? repoRoot;

  const app = express();
  app.get('/api/diff', async (_req, res) => {
    try {
      const patch = await runGit(repoRoot, getPatchArgs(args));
      const head = runGitSync(repoRoot, ['rev-parse', '--short', 'HEAD']);
      res.json({
        ref: displayRef,
        repositoryName,
        repoRoot,
        head,
        patch,
        patchBytes: Buffer.byteLength(patch),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/raw.diff', async (_req, res) => {
    try {
      const patch = await runGit(repoRoot, getPatchArgs(args));
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
  console.log(`Local DiffsHub: ${url}`);
  console.log(`Repo: ${repoRoot}`);
  console.log(`Ref:  ${displayRef}`);

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
