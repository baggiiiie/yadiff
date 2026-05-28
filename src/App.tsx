import { parsePatchFiles, type AnnotationSide, type CodeViewDiffItem, type CodeViewItem, type DiffLineAnnotation, type FileDiffMetadata, type ParsedPatch } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

type DiffStyle = 'split' | 'unified';
type Overflow = 'scroll' | 'wrap';
type LoadState = 'loading' | 'ready' | 'error';

interface DiffResponse {
  target: string;
  repositoryName: string;
  repoRoot: string;
  head: string;
  patch: string;
  patchBytes: number;
  vcs?: 'git' | 'jj';
  commits?: CommitInfo[];
  error?: string;
}

interface CommitInfo {
  id: string;
  shortId: string;
  message: string;
}

interface FileStats {
  additions: number;
  deletions: number;
  files: number;
}

interface LineReview {
  kind: 'saved';
  id: string;
  itemId: string;
  path: string;
  lineNumber: number;
  side: AnnotationSide;
  body: string;
}

interface DraftReview {
  kind: 'draft';
  id: string;
  itemId: string;
  path: string;
  lineNumber: number;
  side: AnnotationSide;
  body: string;
}

type ReviewAnnotation = LineReview | DraftReview;

const REVIEW_UNSAFE_CSS = `
  [data-line-annotation],
  [data-gutter-buffer='annotation'] {
    --diffs-annotation-bg: var(--diffs-bg) !important;
    --diffs-computed-decoration-bg: var(--diffs-bg) !important;
    --diffs-computed-diff-line-bg: var(--diffs-bg) !important;
    --diffs-computed-selected-line-bg: var(--diffs-bg) !important;
    --diffs-line-bg: var(--diffs-bg) !important;
  }
`;

interface ParsedModel {
  patches: ParsedPatch[];
  items: CodeViewItem<ReviewAnnotation>[];
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
  const [reviews, setReviews] = useState<LineReview[]>([]);
  const [draftReview, setDraftReview] = useState<DraftReview | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'empty' | 'error'>('idle');
  const [activeCommitId, setActiveCommitId] = useState<string | null>(null);
  const [commitPatch, setCommitPatch] = useState<string | null>(null);
  const viewerRef = useRef<CodeViewHandle<ReviewAnnotation>>(null);
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
    setReviews([]);
    setDraftReview(null);
    setCopyStatus('idle');
    setActiveCommitId(null);
    setCommitPatch(null);
  }, [response?.target]);

  useEffect(() => {
    if (activeCommitId == null) {
      setCommitPatch(null);
      return;
    }
    let cancelled = false;
    const commitId = activeCommitId;
    async function fetchCommitPatch() {
      try {
        const result = await fetch(`/api/diff/${encodeURIComponent(commitId)}`, { cache: 'no-store' });
        const data = await result.json();
        if (!result.ok) {
          throw new Error(data.error ?? `Request failed (${result.status})`);
        }
        if (!cancelled) {
          setCommitPatch(data.patch);
        }
      } catch {
        if (!cancelled) {
          setCommitPatch(null);
        }
      }
    }
    void fetchCommitPatch();
    return () => { cancelled = true; };
  }, [activeCommitId]);

  useEffect(() => {
    setCollapsedIds(new Set());
    setReviews([]);
    setDraftReview(null);
  }, [activeCommitId]);

  const parsed = useMemo<ParsedModel>(() => {
    if (response == null) {
      return INITIAL_PARSED_MODEL;
    }
    const activePatch = activeCommitId != null && commitPatch != null ? commitPatch : response.patch;
    const patchKey = activeCommitId ?? response.target;
    const patches = parsePatchFiles(activePatch, encodeURIComponent(patchKey));
    return buildParsedModel(patches, collapsedIds, reviews, draftReview);
  }, [activeCommitId, collapsedIds, commitPatch, draftReview, response, reviews]);

  const allCollapsed = parsed.items.length > 0 && parsed.items.every((item) => collapsedIds.has(item.id));
  const toggleAllCollapsed = () => {
    setCollapsedIds(allCollapsed ? new Set() : new Set(parsed.items.map((item) => item.id)));
  };

  const showCopyStatus = (status: 'copied' | 'empty' | 'error') => {
    setCopyStatus(status);
    window.setTimeout(() => setCopyStatus('idle'), status === 'error' ? 2000 : 1500);
  };

  const copyReviews = async () => {
    if (reviews.length === 0) {
      showCopyStatus('empty');
      return;
    }

    const targetLabel = response?.vcs === 'jj'
      ? `jj revision ${response.target}`
      : `Git commit ${response?.target ?? 'unknown'}`;
    const header = `Below is my review for ${targetLabel}`;
    const body = reviews
      .map((review, index) => `${index + 1}. ${review.path}:${review.lineNumber} (${formatReviewSide(review.side)})\n   ${review.body}`)
      .join('\n');
    const text = `${header}\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      showCopyStatus('copied');
    } catch {
      showCopyStatus('error');
    }
  };

  const reviewButtonLabel = copyStatus === 'idle' ? `Reviews (${reviews.length})` : formatCopyStatus(copyStatus);

  useEffect(() => {
    treeModel.resetPaths(parsed.paths);
    treeModel.setGitStatus(parsed.gitStatus);
  }, [parsed.paths, parsed.gitStatus, treeModel]);

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
    return <Shell message="Fetching diff from local repository…" />;
  }

  if (loadState === 'error') {
    return <Shell message="Could not render this diff" details={error ?? undefined} />;
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="titleBlock">
          <div className="eyebrow">yadiff</div>
          <h1>{response?.repositoryName} <span>{response?.target}</span></h1>
        </div>
        <div className="stats" aria-label="Diff stats">
          <strong>{parsed.stats.files}</strong> files
          <span className="plus">+{parsed.stats.additions}</span>
          <span className="minus">−{parsed.stats.deletions}</span>
        </div>
        <a
          className="poweredBy"
          href="https://github.com/pierrecomputer/pierre/tree/main/packages"
          target="_blank"
          rel="noreferrer"
          title="Powered by @pierre/diffs and @pierre/trees"
        >
          Powered by Diffs and Trees
        </a>
        <div className="controls">
          <PillButton active={diffStyle === 'unified'} onClick={() => setDiffStyle(diffStyle === 'unified' ? 'split' : 'unified')}>
            Unified
          </PillButton>
          <PillButton active={overflow === 'wrap'} onClick={() => setOverflow(overflow === 'wrap' ? 'scroll' : 'wrap')}>
            Wrap
          </PillButton>
          <PillButton active={lineNumbers} onClick={() => setLineNumbers((value) => !value)}>
            Lines
          </PillButton>
          <PillButton active={showBackgrounds} onClick={() => setShowBackgrounds((value) => !value)}>
            Background
          </PillButton>
          <PillButton active={allCollapsed} onClick={toggleAllCollapsed} title={allCollapsed ? 'Expand all files' : 'Collapse all files'}>
            Collapse
          </PillButton>
          <button className={copyStatus === 'idle' ? 'button' : `button status-${copyStatus}`} onClick={copyReviews} title="Copy reviews">
            {reviewButtonLabel}
          </button>
          <a className="button" href="/api/raw.diff" target="_blank" rel="noreferrer">Raw</a>
        </div>
      </header>

      <aside className="sidebar">
        {response?.commits != null && response.commits.length > 0 && (
          <CommitList
            commits={response.commits}
            activeCommitId={activeCommitId}
            onSelect={setActiveCommitId}
          />
        )}
        <FileTree
          model={treeModel}
          header={<TreeHeader stats={parsed.stats} />}
          className="fileTree"
          style={{ height: '100%' }}
        />
      </aside>

      <main className="viewer">
        {parsed.items.length === 0 ? (
          <div className="empty">No patch content found for this target.</div>
        ) : (
          <CodeView
            ref={viewerRef}
            key={`${response?.target}:${activeCommitId ?? 'combined'}`}
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
              enableGutterUtility: true,
              enableLineSelection: false,
              stickyHeaders: true,
              unsafeCSS: REVIEW_UNSAFE_CSS,
              layout: { paddingTop: 12, paddingBottom: 32, gap: 12 },
              onGutterUtilityClick: (range, context) => {
                if (context.item.type !== 'diff') {
                  return;
                }
                const side = normalizeReviewSide(range.endSide ?? range.side);
                const lineNumber = range.end;
                const path = context.item.fileDiff.name || context.item.fileDiff.prevName || context.item.id;
                setDraftReview({
                  kind: 'draft',
                  id: `draft:${context.item.id}:${side}:${lineNumber}`,
                  itemId: context.item.id,
                  path,
                  lineNumber,
                  side,
                  body: '',
                });
                setCopyStatus('idle');
              },
            }}
            renderAnnotation={(annotation) => {
              const review = annotation.metadata;
              if (review == null) {
                return null;
              }
              if (review.kind === 'draft') {
                return (
                  <DraftReviewBox
                    draft={review}
                    onChange={(body) => setDraftReview((current) => current?.id === review.id ? { ...current, body } : current)}
                    onCancel={() => setDraftReview((current) => current?.id === review.id ? null : current)}
                    onSave={() => {
                      const body = review.body.trim();
                      if (body.length === 0) {
                        return;
                      }
                      setReviews((current) => [
                        ...current,
                        {
                          kind: 'saved',
                          id: `${review.itemId}:${review.side}:${review.lineNumber}:${Date.now()}`,
                          itemId: review.itemId,
                          path: review.path,
                          lineNumber: review.lineNumber,
                          side: review.side,
                          body,
                        },
                      ]);
                      setDraftReview(null);
                    }}
                  />
                );
              }
              return (
                <div className="reviewAnnotation">
                  <div className="reviewAnnotationMeta">{review.path}:{review.lineNumber} ({formatReviewSide(review.side)})</div>
                  <div className="reviewAnnotationBody">{review.body}</div>
                  <button
                    type="button"
                    className="reviewAnnotationDelete"
                    onClick={() => setReviews((current) => current.filter((item) => item.id !== review.id))}
                  >
                    Delete
                  </button>
                </div>
              );
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

function buildParsedModel(
  patches: ParsedPatch[],
  collapsedIds: ReadonlySet<string>,
  reviews: readonly LineReview[],
  draftReview: DraftReview | null
): ParsedModel {
  const items: CodeViewItem<ReviewAnnotation>[] = [];
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
      const annotations: DiffLineAnnotation<ReviewAnnotation>[] = reviews
        .filter((review) => review.itemId === itemId)
        .map((review) => ({
          side: review.side,
          lineNumber: review.lineNumber,
          metadata: review,
        }));
      if (draftReview?.itemId === itemId) {
        annotations.push({
          side: draftReview.side,
          lineNumber: draftReview.lineNumber,
          metadata: draftReview,
        });
      }
      items.push({
        id: itemId,
        type: 'diff',
        fileDiff,
        annotations,
        collapsed: isCollapsed,
        version: getItemVersion(isCollapsed, annotations),
      } satisfies CodeViewDiffItem<ReviewAnnotation>);
    }
  }

  return { patches, items, files, paths: Array.from(new Set(paths)), itemIdByPath, stats, gitStatus };
}

function getItemVersion(
  isCollapsed: boolean,
  annotations: readonly DiffLineAnnotation<ReviewAnnotation>[]
): number {
  let hash = isCollapsed ? 17 : 31;
  for (const annotation of annotations) {
    const metadata = annotation.metadata;
    hash = hashNumber(hash, annotation.lineNumber);
    hash = hashString(hash, annotation.side);
    if (metadata != null) {
      hash = hashString(hash, metadata.id);
      hash = hashString(hash, metadata.body);
      hash = hashString(hash, metadata.kind);
    }
  }
  return hash;
}

function hashNumber(hash: number, value: number): number {
  return (Math.imul(hash, 33) + value) >>> 0;
}

function hashString(hash: number, value: string): number {
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(hash, 33) + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalizeReviewSide(side: AnnotationSide | undefined): AnnotationSide {
  return side ?? 'additions';
}

function formatReviewSide(side: AnnotationSide): 'old' | 'new' {
  return side === 'deletions' ? 'old' : 'new';
}

function formatCopyStatus(status: 'copied' | 'empty' | 'error') {
  if (status === 'copied') return 'Copied';
  if (status === 'empty') return 'No reviews';
  return 'Copy failed';
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

function DraftReviewBox({
  draft,
  onCancel,
  onChange,
  onSave,
}: {
  draft: DraftReview;
  onCancel: () => void;
  onChange: (body: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="reviewAnnotation reviewDraft">
      <div className="reviewAnnotationMeta">{draft.path}:{draft.lineNumber} ({formatReviewSide(draft.side)})</div>
      <textarea
        autoFocus
        className="reviewTextarea"
        placeholder="Leave a review comment"
        value={draft.body}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="reviewDraftActions">
        <button type="button" className="reviewSaveButton" onClick={onSave} disabled={draft.body.trim().length === 0}>
          Add review
        </button>
        <button type="button" className="reviewCancelButton" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DiffHeader({ item, onToggle }: { item: CodeViewDiffItem<ReviewAnnotation>; onToggle: () => void }) {
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
        <span className={`chevron ${item.collapsed ? 'collapsed' : ''}`} aria-hidden="true">›</span>
        <ChangeIcon type={file.type} />
        <span className="fileTitleText">
          {file.prevName != null && file.prevName !== file.name ? (
            <>
              <span>{file.prevName}</span>
              <span className="renameArrow">⟶</span>
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

function CommitList({
  commits,
  activeCommitId,
  onSelect,
}: {
  commits: CommitInfo[];
  activeCommitId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="commitList">
      <div className="commitListHeader">Commits</div>
      <button
        type="button"
        className={activeCommitId == null ? 'commitItem active' : 'commitItem'}
        onClick={() => onSelect(null)}
      >
        <span className="commitItemLabel">All changes (combined)</span>
      </button>
      {commits.map((commit) => (
        <button
          key={commit.id}
          type="button"
          className={activeCommitId === commit.id ? 'commitItem active' : 'commitItem'}
          onClick={() => onSelect(commit.id)}
          title={commit.id}
        >
          <span className="commitItemShortId">{commit.shortId}</span>
          <span className="commitItemMessage">{commit.message}</span>
        </button>
      ))}
    </div>
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

function PillButton({
  active,
  children,
  onClick,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={active ? 'button active' : 'button'}
      aria-pressed={active}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
