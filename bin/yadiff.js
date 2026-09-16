#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import MarkdownIt from 'markdown-it';

import { parsePatchFiles, processFile } from '@pierre/diffs';

import { createTarget } from '../lib/target/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const BACKGROUND_SERVER_ENV = 'YADIFF_BACKGROUND_SERVER';
const SERVER_IDLE_TIMEOUT_MS = 60_000;

function printUsage() {
  console.log(`Usage: yadiff [git-ref-or-range-or-jj-revset-or-github-pr-url] [options]
       yadiff --working [options]
       yadiff --staged [options]
       yadiff --dirty [options]

Examples:
  yadiff
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
  No target defaults to --working.
  --working          Show unstaged file changes, including untracked files (git diff), or jj @ in a jj workspace
  --staged           Show staged changes (git diff --cached; git only)
  --dirty            Show staged + unstaged file changes, including untracked files (git diff HEAD), or jj @ in a jj workspace
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
    args.mode = 'working';
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
  const hydratedDiffCache = new Map();
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

  app.get('/api/hydrated-diff', async (req, res) => {
    try {
      const commitId = typeof req.query.commitId === 'string' ? req.query.commitId : null;
      const viewKey = commitId == null ? 'combined' : `commit:${commitId}`;
      const patch = commitId == null ? await target.getPatch() : await target.getCommitPatch(commitId);
      const cacheKey = `${viewKey}:${hashString(patch)}`;
      const cached = hydratedDiffCache.get(cacheKey);
      if (cached != null) {
        res.json(cached);
        return;
      }

      const hydrated = await createHydratedDiffResponse(target, patch, cacheKey);
      hydratedDiffCache.set(cacheKey, hydrated);
      res.json(hydrated);
    } catch (error) {
      res.status(target.source === 'github' ? 400 : 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/file', async (req, res) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : null;
      if (path == null) {
        res.status(400).type('text/plain').send('Missing path query parameter.');
        return;
      }
      if (typeof target.getFileContents !== 'function') {
        res.status(404).type('text/plain').send('Full file contents are not available for this source.');
        return;
      }

      const commitId = typeof req.query.commitId === 'string' ? req.query.commitId : null;
      const patch = commitId == null ? await target.getPatch() : await target.getCommitPatch(commitId);
      const file = findPatchedFile(parsePatchFiles(patch), path);
      if (file == null) {
        res.status(404).type('text/plain').send(`No changed file matches ${path}.`);
        return;
      }

      const contents = await target.getFileContents(file);
      const side = file.type === 'deleted' ? contents?.oldFile : contents?.newFile;
      if (side == null) {
        res.status(404).type('text/plain').send(`Could not read the full contents of ${path}.`);
        return;
      }

      if (req.query.format === 'raw') {
        res
          .type('text/plain; charset=utf-8')
          .set('X-Content-Type-Options', 'nosniff')
          .set('Content-Disposition', 'inline')
          .send(side.contents);
        return;
      }

      const markdownFile = isMarkdownPath(file.name);
      res
        .type('text/html; charset=utf-8')
        .set('X-Content-Type-Options', 'nosniff')
        .set('Content-Security-Policy', markdownFile ? MARKDOWN_PAGE_CSP : SOURCE_PAGE_CSP)
        .set('Content-Disposition', 'inline')
        .send(markdownFile
          ? renderMarkdownPage({ contents: side.contents, path: file.name })
          : renderFilePage({
              addedLines: getAddedLineNumbers(file),
              contents: side.contents,
              path: file.name,
            }));
    } catch (error) {
      res.status(target.source === 'github' ? 400 : 500).type('text/plain').send(error instanceof Error ? error.message : String(error));
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

async function createHydratedDiffResponse(target, patch, cacheKeyPrefix) {
  const parsedPatches = parsePatchFiles(patch, encodeURIComponent(cacheKeyPrefix));
  if (typeof target.getFileContents !== 'function') {
    return { patches: parsedPatches, hydratedFiles: 0, totalFiles: countParsedFiles(parsedPatches) };
  }

  const filePatchChunks = splitPatchFileChunks(patch);
  let fileChunkIndex = 0;
  let hydratedFiles = 0;
  let totalFiles = 0;
  const patches = [];

  for (let patchIndex = 0; patchIndex < parsedPatches.length; patchIndex++) {
    const parsedPatch = parsedPatches[patchIndex];
    const files = [];
    for (let fileIndex = 0; fileIndex < parsedPatch.files.length; fileIndex++) {
      const partialFile = parsedPatch.files[fileIndex];
      const filePatch = filePatchChunks[fileChunkIndex++];
      totalFiles++;

      if (filePatch == null) {
        files.push(partialFile);
        continue;
      }

      try {
        const contents = await target.getFileContents(partialFile);
        if (contents == null) {
          files.push(partialFile);
          continue;
        }

        const hydratedFile = processFile(filePatch, {
          ...contents,
          cacheKey: `${encodeURIComponent(cacheKeyPrefix)}-${patchIndex}-${fileIndex}:hydrated`,
          throwOnError: true,
        });
        if (hydratedFile == null) {
          files.push(partialFile);
          continue;
        }
        files.push(hydratedFile);
        if (!hydratedFile.isPartial) {
          hydratedFiles++;
        }
      } catch {
        files.push(partialFile);
      }
    }
    patches.push({ ...parsedPatch, files });
  }

  return { patches, hydratedFiles, totalFiles };
}

function splitPatchFileChunks(patch) {
  const starts = [];
  const diffHeader = /^diff --git /gm;
  let match;
  while ((match = diffHeader.exec(patch)) != null) {
    starts.push(match.index);
  }

  return starts.map((start, index) => patch.slice(start, starts[index + 1]));
}

function countParsedFiles(patches) {
  return patches.reduce((total, patch) => total + patch.files.length, 0);
}

function findPatchedFile(patches, path) {
  for (const patch of patches) {
    for (const file of patch.files) {
      if (file.name === path || file.prevName === path) {
        return file;
      }
    }
  }
  return undefined;
}

/**
 * New-side line numbers that this diff introduces. Deletions are deliberately ignored:
 * the file page renders the file as it exists now, so removed lines have nothing to mark.
 * Added files are covered by the same walk, since git emits one hunk spanning the file.
 */
function getAddedLineNumbers(file) {
  const added = new Set();
  for (const hunk of file.hunks) {
    let lineNumber = hunk.additionStart;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        lineNumber += content.lines;
        continue;
      }
      for (let offset = 0; offset < content.additions; offset++) {
        added.add(lineNumber + offset);
      }
      lineNumber += content.additions;
    }
  }
  return added;
}

const SOURCE_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/**
 * Markdown pages allow inline HTML, which READMEs commonly use for badges and inline
 * images. Scripts still cannot run: the page declares no script-src, so it falls back to
 * default-src 'none'. form-action and base-uri are pinned for the same reason.
 */
const MARKDOWN_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'none'; base-uri 'none'";

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'];

const markdown = new MarkdownIt({ html: true, linkify: true });

function isMarkdownPath(path) {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

const PAGE_BASE_CSS = `
:root {
  color-scheme: light dark;
  --page-bg: #ffffff;
  --page-fg: #18181b;
  --page-muted: #52525b;
  --page-border: rgba(0, 0, 0, 0.12);
  --page-code-bg: rgba(0, 0, 0, 0.05);
  --page-link: #2563eb;
  --page-added-bg: rgba(46, 160, 67, 0.15);
}
@media (prefers-color-scheme: dark) {
  :root {
    --page-bg: #09090b;
    --page-fg: #f4f4f5;
    --page-muted: #a1a1aa;
    --page-border: rgba(255, 255, 255, 0.14);
    --page-code-bg: rgba(255, 255, 255, 0.06);
    --page-link: #7aa2f7;
    --page-added-bg: rgba(46, 160, 67, 0.22);
  }
}
html, body { margin: 0; background: var(--page-bg); color: var(--page-fg); }
`;

/* Scoped to .source so the line-box rules cannot leak into rendered markdown. */
const SOURCE_CSS = `
.source pre {
  margin: 0;
  padding: 12px 0;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.5;
  tab-size: 4;
}
.source code { display: block; width: max-content; min-width: 100%; }
.line { display: block; padding: 0 16px; }
.line.added { background: var(--page-added-bg); }
`;

const MARKDOWN_CSS = `
.markdown {
  max-width: 860px;
  margin: 0 auto;
  padding: 28px 20px 72px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.6;
}
.markdown > :first-child { margin-top: 0; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5 { margin: 1.5em 0 0.6em; line-height: 1.25; }
.markdown h1 { font-size: 27px; padding-bottom: 0.3em; border-bottom: 1px solid var(--page-border); }
.markdown h2 { font-size: 21px; padding-bottom: 0.3em; border-bottom: 1px solid var(--page-border); }
.markdown h3 { font-size: 17px; }
.markdown p, .markdown ul, .markdown ol, .markdown blockquote, .markdown table, .markdown pre { margin: 0 0 1em; }
.markdown ul, .markdown ol { padding-left: 1.5em; }
.markdown li + li { margin-top: 0.2em; }
.markdown a { color: var(--page-link); }
.markdown code {
  padding: 0.15em 0.35em;
  border-radius: 5px;
  background: var(--page-code-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
}
.markdown pre { overflow-x: auto; padding: 12px 14px; border: 1px solid var(--page-border); border-radius: 10px; background: var(--page-code-bg); }
.markdown pre code { padding: 0; background: transparent; }
.markdown blockquote { padding: 0 1em; border-left: 3px solid var(--page-border); color: var(--page-muted); }
.markdown img { max-width: 100%; }
.markdown table { border-collapse: collapse; }
.markdown th, .markdown td { border: 1px solid var(--page-border); padding: 6px 10px; }
.markdown hr { margin: 2em 0; border: 0; border-top: 1px solid var(--page-border); }
`;

function renderHtmlPage({ body, path, styles }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(path)}</title>
<style>${PAGE_BASE_CSS}${styles}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Render the whole file as a standalone read-only page. File contents are untrusted text,
 * so every line and the title are escaped before being placed in the document.
 */
function renderFilePage({ addedLines, contents, path }) {
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const body = lines
    .map((line, index) => {
      const className = addedLines.has(index + 1) ? 'line added' : 'line';
      return `<span class="${className}">${escapeHtml(line)}</span>`;
    })
    .join('\n');

  return renderHtmlPage({
    body: `<div class="source"><pre><code>${body}</code></pre></div>`,
    path,
    styles: SOURCE_CSS,
  });
}

/**
 * Render markdown as a formatted page. Inline HTML is kept so READMEs keep their badges and
 * inline images; the response CSP is what keeps scripts and form posts out of the page.
 */
function renderMarkdownPage({ contents, path }) {
  return renderHtmlPage({
    body: `<article class="markdown">${markdown.render(contents)}</article>`,
    path,
    styles: MARKDOWN_CSS,
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    version = pkg.version ?? 'unknown';
  } catch {
    return version;
  }

  const gitHash = readGitCommitHash();
  if (gitHash == null) return version;

  return version.replace(/-dev(?:\.\d+)?$/, `-dev-${gitHash}`);
}

function readGitCommitHash() {
  const result = spawnSync('git', ['-C', projectRoot, 'rev-parse', '--short=8', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;

  const hash = result.stdout.trim();
  return hash === '' ? null : hash;
}

function formatSource(source) {
  if (source === 'github') return 'GitHub';
  return source;
}

function hashString(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(hash, 33) ^ value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
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
