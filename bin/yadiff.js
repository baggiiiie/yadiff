#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createTarget } from '../lib/target/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const BACKGROUND_SERVER_ENV = 'YADIFF_BACKGROUND_SERVER';
const SERVER_IDLE_TIMEOUT_MS = 60_000;

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
  --foreground      Keep the local server attached to this terminal
  --verbose         Print server/source details while running
  --dev             Use Vite dev server (for development only)
  -v, --version     Show version
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
    vcs: 'auto',
    dev: false,
    foreground: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '-v' || arg === '--version') {
      args.version = true;
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
    } else if (arg === '--foreground') {
      args.foreground = true;
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--dev') {
      args.dev = true;
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

function isBackgroundServerProcess() {
  return process.env[BACKGROUND_SERVER_ENV] === '1';
}

function shouldLaunchBackgroundServer(args) {
  return !args.dev && !args.foreground && !args.verbose && !isBackgroundServerProcess();
}

async function launchBackgroundServer(argv) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      [BACKGROUND_SERVER_ENV]: '1',
    },
    windowsHide: true,
  });
  child.unref();

  const { url, opened } = await waitForBackgroundServer(child);
  if (child.connected) {
    child.disconnect();
  }

  if (!opened) {
    console.error(`yadiff: could not open the browser automatically; visit ${url}`);
  }
}

function waitForBackgroundServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const startupTimer = setTimeout(() => {
      settle(() => {
        child.kill();
        rejectReady(new Error('Timed out starting yadiff background server.'));
      });
    }, 15_000);

    function settle(complete) {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
      complete();
    }

    function onMessage(message) {
      if (message?.type === 'ready' && typeof message.url === 'string') {
        settle(() => resolveReady({ url: message.url, opened: message.opened !== false }));
      } else if (message?.type === 'error') {
        settle(() => rejectReady(new Error(String(message.error ?? 'Could not start yadiff background server.'))));
      }
    }

    function onError(error) {
      settle(() => rejectReady(error));
    }

    function onExit(code, signal) {
      settle(() => rejectReady(new Error(`yadiff background server exited before it was ready (${signal ?? code ?? 'unknown'}).`)));
    }

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

function notifyParent(message) {
  if (typeof process.send !== 'function') return false;
  try {
    process.send(message);
    return true;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  return new Promise((resolveOpen) => {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const openerArgs = process.platform === 'win32' ? ['/c', 'start', url] : [url];
    const child = spawn(opener, openerArgs, { detached: true, stdio: 'ignore', windowsHide: true });
    let settled = false;
    let fallbackTimer;

    function settle(opened) {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      resolveOpen(opened);
    }

    fallbackTimer = setTimeout(() => settle(true), 1500);
    child.on('error', () => settle(false));
    child.on('exit', (code) => settle(code === 0));
    child.unref();
  });
}

async function attachViteDevMiddleware(app, verbose) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: projectRoot,
    appType: 'spa',
    logLevel: verbose ? 'info' : 'error',
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}

function attachStaticMiddleware(app) {
  const distPath = resolve(projectRoot, 'dist');
  if (!existsSync(distPath)) {
    throw new Error(
      `dist/ directory not found at ${distPath}. Run "npm run build" first, or use --dev for development.`
    );
  }
  app.use(express.static(distPath));
  // SPA fallback: serve index.html for any non-API, non-asset request
  app.use((_req, res) => {
    res.sendFile(resolve(distPath, 'index.html'));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.version) {
    console.log(readVersion());
    return;
  }
  if (args.help) {
    printUsage();
    return;
  }
  if (args.target == null && args.mode == null) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (shouldLaunchBackgroundServer(args)) {
    await launchBackgroundServer(argv);
    return;
  }

  await runServer(args);
}

async function runServer(args) {
  const target = createTarget(args);
  const displayTarget = target.target ?? getDisplayTarget(args);
  const repositoryName = target.repositoryName ?? target.repoRoot.split('/').filter(Boolean).at(-1) ?? target.repoRoot;

  const app = express();
  const backgroundServer = isBackgroundServerProcess();
  let activeBrowserSessions = 0;
  let idleShutdownTimer = null;

  function cancelIdleShutdown() {
    if (idleShutdownTimer == null) return;
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }

  function scheduleIdleShutdown() {
    if (idleShutdownTimer != null || activeBrowserSessions > 0) return;

    idleShutdownTimer = setTimeout(() => {
      idleShutdownTimer = null;
      if (activeBrowserSessions > 0) return;

      if (args.verbose) {
        console.log('yadiff: no active browser sessions, shutting down server...');
      }
      server.close((error) => {
        if (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
        process.exit(0);
      });
      server.closeIdleConnections?.();
    }, SERVER_IDLE_TIMEOUT_MS);
    idleShutdownTimer.unref?.();
  }

  app.get('/api/session', (req, res) => {
    activeBrowserSessions += 1;
    cancelIdleShutdown();

    req.socket.setTimeout(0);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('retry: 1000\n');
    res.write('event: session\ndata: {"status":"connected"}\n\n');

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15000);
    heartbeat.unref?.();

    let closed = false;
    req.on('close', () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      activeBrowserSessions = Math.max(0, activeBrowserSessions - 1);
      if (activeBrowserSessions === 0) {
        scheduleIdleShutdown();
      }
    });
  });

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

  if (args.dev) {
    await attachViteDevMiddleware(app, args.verbose);
  } else {
    attachStaticMiddleware(app);
  }

  const server = createServer(app);
  const boundPort = await listenWithFallback(server, args.port, args.host, args.portExplicit, args.verbose);
  const url = `http://${args.host}:${boundPort}/`;

  if (args.verbose) {
    console.log(`yadiff: ${url}`);
  }
  if (target.source === 'github') {
    if (args.verbose) {
      console.log(`Fetching GitHub PR diff: ${displayTarget}`);
    }
    target.getPatch()
      .then((patch) => {
        if (args.verbose) {
          console.log(`Fetched ${formatBytes(Buffer.byteLength(patch))} from GitHub.`);
        }
      })
      .catch((error) => console.error(error instanceof Error ? error.message : String(error)));
  }
  if (args.verbose) {
    console.log(`Repo: ${repositoryName}`);
    console.log(`Source: ${formatSource(target.source)}`);
    console.log(`Target: ${displayTarget}`);
  }

  const opened = await openBrowser(url);
  if (backgroundServer) {
    notifyParent({ type: 'ready', url, opened });
  } else if (!opened) {
    console.error(`yadiff: could not open the browser automatically; visit ${url}`);
  }
  scheduleIdleShutdown();
}

function listenWithFallback(server, preferredPort, host, portExplicit, verbose) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (err) => {
      if (err && err.code === 'EADDRINUSE' && !portExplicit) {
        server.removeListener('error', onError);
        if (verbose) {
          console.warn(`yadiff: port ${preferredPort} is busy, picking a free one...`);
        }
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

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
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
  const message = error instanceof Error ? error.message : String(error);
  if (isBackgroundServerProcess()) {
    notifyParent({ type: 'error', error: message });
  } else {
    console.error(message);
  }
  process.exit(1);
});
