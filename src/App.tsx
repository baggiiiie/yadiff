import { parsePatchFiles, type CodeViewDiffItem, type CodeViewItem, type FileDiffMetadata, type ParsedPatch } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { useEffect, useMemo, useRef, useState } from 'react';

type DiffStyle = 'split' | 'unified';
type Overflow = 'scroll' | 'wrap';
type LoadState = 'loading' | 'ready' | 'error';

interface DiffResponse {
  ref: string;
  repositoryName: string;
  repoRoot: string;
  head: string;
  patch: string;
  patchBytes: number;
  error?: string;
}

interface FileStats {
  additions: number;
  deletions: number;
  files: number;
}

interface ParsedModel {
  patches: ParsedPatch[];
  items: CodeViewItem[];
  files: FileDiffMetadata[];
  paths: string[];
  itemIdByPath: Map<string, string>;
  stats: FileStats;
  gitStatus: GitStatusEntry[];
}

const INITIAL_PARSED_MODEL: ParsedModel = {
  patches: [],
  items: [],
  files: [],
  paths: [],
  itemIdByPath: new Map(),
  stats: { additions: 0, deletions: 0, files: 0 },
  gitStatus: [],
};

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<DiffResponse | null>(null);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(() =>
    window.matchMedia('(max-width: 800px)').matches ? 'unified' : 'split'
  );
  const [overflow, setOverflow] = useState<Overflow>('scroll');
  const [showBackgrounds, setShowBackgrounds] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [pendingTreeScrollItemId, setPendingTreeScrollItemId] = useState<string | null>(null);
  const viewerRef = useRef<CodeViewHandle<undefined>>(null);
  const onTreeSelectionRef = useRef<(paths: readonly string[]) => void>(() => undefined);
  const { model: treeModel } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: 'open',
    onSelectionChange(paths) {
      onTreeSelectionRef.current(paths);
    },
    search: true,
    stickyFolders: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadState('loading');
      setError(null);
      try {
        const result = await fetch('/api/diff', { cache: 'no-store' });
        const data = (await result.json()) as DiffResponse;
        if (!result.ok) {
          throw new Error(data.error ?? `Request failed (${result.status})`);
        }
        if (!cancelled) {
          setResponse(data);
          setLoadState('ready');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setLoadState('error');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCollapsedIds(new Set());
  }, [response?.ref]);

  const parsed = useMemo<ParsedModel>(() => {
    if (response == null) {
      return INITIAL_PARSED_MODEL;
    }
    const patches = parsePatchFiles(response.patch, encodeURIComponent(response.ref));
    return buildParsedModel(patches, collapsedIds);
  }, [collapsedIds, response]);

  const allCollapsed = parsed.items.length > 0 && parsed.items.every((item) => collapsedIds.has(item.id));
  const toggleAllCollapsed = () => {
    setCollapsedIds(allCollapsed ? new Set() : new Set(parsed.items.map((item) => item.id)));
  };

  useEffect(() => {
    treeModel.resetPaths(parsed.paths);
    treeModel.setGitStatus(parsed.gitStatus);
  }, [response?.ref, treeModel]);

  useEffect(() => {
    onTreeSelectionRef.current = (paths) => {
      const selectedPath = paths[0];
      if (selectedPath == null) {
        return;
      }
      const itemId = parsed.itemIdByPath.get(selectedPath);
      if (itemId == null) {
        return;
      }
      setPendingTreeScrollItemId(itemId);
      setCollapsedIds((current) => {
        if (!current.has(itemId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    };
  }, [parsed.itemIdByPath]);

  useEffect(() => {
    if (pendingTreeScrollItemId == null) {
      return;
    }

    const item = parsed.items.find((item) => item.id === pendingTreeScrollItemId);
    if (item?.collapsed === true) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      viewerRef.current?.scrollTo({
        type: 'item',
        id: pendingTreeScrollItemId,
        align: 'start',
        behavior: 'smooth-auto',
      });
      setPendingTreeScrollItemId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [parsed.items, pendingTreeScrollItemId]);

  if (loadState === 'loading') {
    return <Shell message="Fetching diff from local git…" />;
  }

  if (loadState === 'error') {
    return <Shell message="Could not render this diff" details={error ?? undefined} />;
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="titleBlock">
          <div className="eyebrow">Local DiffsHub</div>
          <h1>{response?.repositoryName} <span>{response?.ref}</span></h1>
        </div>
        <div className="stats" aria-label="Diff stats">
          <strong>{parsed.stats.files}</strong> files
          <span className="plus">+{parsed.stats.additions}</span>
          <span className="minus">−{parsed.stats.deletions}</span>
        </div>
        <div className="controls">
          <Segmented<DiffStyle>
            label="Diff style"
            value={diffStyle}
            options={[['split', 'Split'], ['unified', 'Unified']]}
            onChange={setDiffStyle}
          />
          <Segmented<Overflow>
            label="Overflow"
            value={overflow}
            options={[['scroll', 'Scroll'], ['wrap', 'Wrap']]}
            onChange={setOverflow}
          />
          <Toggle label="Lines" checked={lineNumbers} onChange={setLineNumbers} />
          <Toggle label="Background" checked={showBackgrounds} onChange={setShowBackgrounds} />
          <button className="button" onClick={toggleAllCollapsed}>
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
          <a className="button" href="/api/raw.diff" target="_blank" rel="noreferrer">Raw</a>
        </div>
      </header>

      <aside className="sidebar">
        <FileTree
          model={treeModel}
          header={<TreeHeader stats={parsed.stats} />}
          className="fileTree"
          style={{ height: '100%' }}
        />
      </aside>

      <main className="viewer">
        {parsed.items.length === 0 ? (
          <div className="empty">No patch content found for this ref.</div>
        ) : (
          <CodeView
            ref={viewerRef}
            key={response?.ref}
            items={parsed.items}
            disableWorkerPool
            className="codeView"
            options={{
              diffStyle,
              overflow,
              disableLineNumbers: !lineNumbers,
              disableBackground: !showBackgrounds,
              diffIndicators: 'bars',
              hunkSeparators: 'line-info',
              collapsedContextThreshold: 2,
              expansionLineCount: 50,
              lineHoverHighlight: 'both',
              enableLineSelection: true,
              stickyHeaders: true,
              layout: { paddingTop: 12, paddingBottom: 32, gap: 12 },
            }}
            renderCustomHeader={(item) => {
              if (item.type !== 'diff') return null;
              return (
                <DiffHeader
                  item={item}
                  onToggle={() => {
                    setCollapsedIds((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) {
                        next.delete(item.id);
                      } else {
                        next.add(item.id);
                      }
                      return next;
                    });
                  }}
                />
              );
            }}
          />
        )}
      </main>
    </div>
  );
}

function buildParsedModel(patches: ParsedPatch[], collapsedIds: ReadonlySet<string>): ParsedModel {
  const items: CodeViewItem[] = [];
  const files: FileDiffMetadata[] = [];
  const paths: string[] = [];
  const itemIdByPath = new Map<string, string>();
  const gitStatus: GitStatusEntry[] = [];
  const stats: FileStats = { additions: 0, deletions: 0, files: 0 };

  for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
    const patch = patches[patchIndex];
    for (let fileIndex = 0; fileIndex < patch.files.length; fileIndex++) {
      const fileDiff = patch.files[fileIndex];
      const path = fileDiff.name || fileDiff.prevName || `unknown-${patchIndex}-${fileIndex}`;
      const itemId = `diff:${patchIndex}:${fileIndex}:${path}`;
      const additions = countAdditions(fileDiff);
      const deletions = countDeletions(fileDiff);

      files.push(fileDiff);
      paths.push(path);
      itemIdByPath.set(path, itemId);
      gitStatus.push({ path, status: statusForFile(fileDiff) });
      stats.files++;
      stats.additions += additions;
      stats.deletions += deletions;
      const isCollapsed = collapsedIds.has(itemId);
      items.push({
        id: itemId,
        type: 'diff',
        fileDiff,
        collapsed: isCollapsed,
        version: isCollapsed ? 1 : 0,
      } satisfies CodeViewDiffItem);
    }
  }

  return { patches, items, files, paths: Array.from(new Set(paths)), itemIdByPath, stats, gitStatus };
}

function statusForFile(file: FileDiffMetadata): GitStatusEntry['status'] {
  if (file.type === 'new') return 'added';
  if (file.type === 'deleted') return 'deleted';
  if (file.type === 'rename-pure' || file.type === 'rename-changed') return 'renamed';
  return 'modified';
}

function countAdditions(file: FileDiffMetadata) {
  return file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
}

function countDeletions(file: FileDiffMetadata) {
  return file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
}

function DiffHeader({ item, onToggle }: { item: CodeViewDiffItem; onToggle: () => void }) {
  const file = item.fileDiff;
  return (
    <div className="customFileHeader">
      <button
        type="button"
        className="fileTitleButton"
        aria-expanded={!item.collapsed}
        onClick={onToggle}
        title={item.collapsed ? 'Expand file' : 'Collapse file'}
      >
        <span className="chevron" aria-hidden="true">{item.collapsed ? '▸' : '▾'}</span>
        <ChangeIcon type={file.type} />
        <span className="fileTitleText">
          {file.prevName != null && file.prevName !== file.name ? (
            <>
              <span>{file.prevName}</span>
              <span className="renameArrow">→</span>
            </>
          ) : null}
          <span>{file.name}</span>
        </span>
      </button>
      <FileMeta file={file} />
    </div>
  );
}

function ChangeIcon({ type }: { type: FileDiffMetadata['type'] }) {
  const label = type === 'new'
    ? 'Added file'
    : type === 'deleted'
      ? 'Deleted file'
      : type === 'rename-pure' || type === 'rename-changed'
        ? 'Renamed file'
        : 'Modified file';

  return (
    <span className="changeIcon" data-change-type={type} aria-label={label} title={label}>
      {type === 'new' ? '+' : type === 'deleted' ? '−' : type === 'rename-pure' || type === 'rename-changed' ? '↪' : '●'}
    </span>
  );
}

function FileMeta({ file }: { file: FileDiffMetadata }) {
  const additions = countAdditions(file);
  const deletions = countDeletions(file);
  return (
    <span className="fileMeta">
      <span>{file.type}</span>
      <span className="plus">+{additions}</span>
      <span className="minus">−{deletions}</span>
    </span>
  );
}

function TreeHeader({ stats }: { stats: FileStats }) {
  return (
    <div className="treeHeader">
      <span>Files changed</span>
      <strong>{stats.files}</strong>
    </div>
  );
}

function Shell({ message, details }: { message: string; details?: string }) {
  return (
    <div className="shell">
      <div className="card">
        <div className="spinner" />
        <h1>{message}</h1>
        {details != null ? <pre>{details}</pre> : <p>Parsing and highlighting will happen in your browser.</p>}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" aria-label={label}>
      {options.map(([optionValue, text]) => (
        <button
          key={optionValue}
          className={optionValue === value ? 'active' : undefined}
          onClick={() => onChange(optionValue)}
          type="button"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}
