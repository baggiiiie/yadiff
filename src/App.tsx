import type { AnnotationSide } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { createDiffProjection, type ProjectedFile, type ProjectedFileIdentity } from './diffProjection';

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
  fileId: ProjectedFileIdentity;
  path: string;
  lineNumber: number;
  side: AnnotationSide;
  body: string;
}

interface DraftReview {
  kind: 'draft';
  id: string;
  fileId: ProjectedFileIdentity;
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
  const [collapsedIds, setCollapsedIds] = useState<Set<ProjectedFileIdentity>>(() => new Set());
  const [pendingTreeScrollFileId, setPendingTreeScrollFileId] = useState<ProjectedFileIdentity | null>(null);
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

  const parsed = useMemo(() => {
    const activePatch = response == null
      ? ''
      : activeCommitId != null && commitPatch != null
        ? commitPatch
        : response.patch;
    const diffKey = response == null ? 'empty' : activeCommitId ?? response.target;
    return createDiffProjection<ReviewAnnotation>({
      patch: activePatch,
      diffKey,
      collapsedFileIds: collapsedIds,
      reviews,
      draftReview,
    });
  }, [activeCommitId, collapsedIds, commitPatch, draftReview, response, reviews]);

  const allCollapsed = parsed.files.length > 0 && parsed.files.every((file) => collapsedIds.has(file.id));
  const toggleAllCollapsed = () => {
    setCollapsedIds(allCollapsed ? new Set() : new Set(parsed.files.map((file) => file.id)));
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
      ? `jj revision "${response.target}"`
      : `Git commit "${response?.target ?? 'unknown'}"`;
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
      const fileId = parsed.getFileIdByPath(selectedPath);
      if (fileId == null) {
        return;
      }
      setPendingTreeScrollFileId(fileId);
      setCollapsedIds((current) => {
        if (!current.has(fileId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(fileId);
        return next;
      });
    };
  }, [parsed]);

  useEffect(() => {
    if (pendingTreeScrollFileId == null) {
      return;
    }

    const file = parsed.getFileById(pendingTreeScrollFileId);
    if (file?.collapsed === true) {
      return;
    }
    const scrollTarget = parsed.getScrollTarget(pendingTreeScrollFileId);
    if (scrollTarget == null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      viewerRef.current?.scrollTo({
        ...scrollTarget,
        align: 'start',
        behavior: 'smooth-auto',
      });
      setPendingTreeScrollFileId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [parsed, pendingTreeScrollFileId]);

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
        {parsed.codeViewItems.length === 0 ? (
          <div className="empty">No patch content found for this target.</div>
        ) : (
          <CodeView
            ref={viewerRef}
            key={`${response?.target}:${activeCommitId ?? 'combined'}`}
            items={parsed.codeViewItems}
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
                const file = parsed.getFileForCodeViewItem(context.item);
                if (file == null) {
                  return;
                }
                const side = normalizeReviewSide(range.endSide ?? range.side);
                const lineNumber = range.end;
                setDraftReview({
                  kind: 'draft',
                  id: `draft:${file.id}:${side}:${lineNumber}`,
                  fileId: file.id,
                  path: file.path,
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
                          id: `${review.fileId}:${review.side}:${review.lineNumber}:${Date.now()}`,
                          fileId: review.fileId,
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
              const file = parsed.getFileForCodeViewItem(item);
              if (file == null) return null;
              return (
                <DiffHeader
                  file={file}
                  onToggle={() => {
                    setCollapsedIds((current) => {
                      const next = new Set(current);
                      if (next.has(file.id)) {
                        next.delete(file.id);
                      } else {
                        next.add(file.id);
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

function DiffHeader({ file, onToggle }: { file: ProjectedFile; onToggle: () => void }) {
  return (
    <div className="customFileHeader">
      <button
        type="button"
        className="fileTitleButton"
        aria-expanded={!file.collapsed}
        onClick={onToggle}
        title={file.collapsed ? 'Expand file' : 'Collapse file'}
      >
        <span className={`chevron ${file.collapsed ? 'collapsed' : ''}`} aria-hidden="true">›</span>
        <ChangeIcon type={file.changeType} />
        <span className="fileTitleText">
          {file.previousPath != null && file.previousPath !== file.path ? (
            <>
              <span>{file.previousPath}</span>
              <span className="renameArrow">⟶</span>
            </>
          ) : null}
          <span>{file.path}</span>
        </span>
      </button>
      <FileMeta file={file} />
    </div>
  );
}

function ChangeIcon({ type }: { type: ProjectedFile['changeType'] }) {
  const label = type === 'new'
    ? 'Added file'
    : type === 'deleted'
      ? 'Deleted file'
      : type === 'renamed'
        ? 'Renamed file'
        : 'Modified file';

  return (
    <span className="changeIcon" data-change-type={type} aria-label={label} title={label}>
      {type === 'new' ? '+' : type === 'deleted' ? '−' : type === 'renamed' ? '↪' : '●'}
    </span>
  );
}

function FileMeta({ file }: { file: ProjectedFile }) {
  return (
    <span className="fileMeta">
      <span>{file.changeType}</span>
      <span className="plus">+{file.additions}</span>
      <span className="minus">−{file.deletions}</span>
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
            <span>{stats.files} files changed</span>
            <span className="plus">+{stats.additions}</span>
            <span className="minus">−{stats.deletions}</span>
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
