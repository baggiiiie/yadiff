import type { AnnotationSide } from '@pierre/diffs';
import { CodeView, type CodeViewHandle, WorkerPoolContextProvider } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import {
  createDiffProjection,
  parseDiffPatch,
  type ProjectedFile,
  type ProjectedFileIdentity,
} from './diffProjection';

type DiffStyle = 'split' | 'unified';
type Overflow = 'scroll' | 'wrap';
type LoadState = 'loading' | 'ready' | 'error';
type Source = 'git' | 'jj' | 'github';

interface DiffResponse {
  status: 'ready';
  target: string;
  repositoryName: string;
  repoRoot: string;
  head: string;
  patchBytes?: number;
  patchUrl: string;
  source: Source;
  commits?: CommitInfo[];
  error?: string;
}

interface DiffStatusResponse {
  status: 'fetching' | 'ready' | 'error';
  source: Source;
  bytesDownloaded?: number;
  patchBytes?: number;
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

const DIFF_WORKER_POOL_OPTIONS = {
  workerFactory: () => new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
};
const DIFF_HIGHLIGHTER_OPTIONS = {};

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadingMessage, setLoadingMessage] = useState('Fetching diff from local repository…');
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<DiffResponse | null>(null);
  const [patch, setPatch] = useState('');
  const [loadedPatchBytes, setLoadedPatchBytes] = useState<number | undefined>(undefined);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(() =>
    window.matchMedia('(max-width: 800px)').matches ? 'unified' : 'split'
  );
  const [overflow, setOverflow] = useState<Overflow>('scroll');
  const [showBackgrounds, setShowBackgrounds] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<ProjectedFileIdentity>>(() => new Set());
  const pendingTreeScrollFileIdRef = useRef<ProjectedFileIdentity | null>(null);
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
      setLoadingMessage('Fetching diff from local repository…');
      setLoadingDetails(null);
      setError(null);
      try {
        const metadata = await fetchDiffMetadata((status) => {
          if (cancelled) return;
          setLoadingMessage(status.source === 'github'
            ? 'Fetching GitHub pull request diff…'
            : 'Fetching diff from local repository…');
          setLoadingDetails(formatStatusDetails(status));
        });
        if (cancelled) return;

        setResponse(metadata);
        setLoadingMessage('Loading diff into browser…');
        setLoadingDetails(metadata.patchBytes != null ? `Diff size: ${formatBytes(metadata.patchBytes)}` : null);
        const rawPatch = await fetchPatchText(metadata.patchUrl, (downloaded, total) => {
          if (cancelled) return;
          const sizeLabel = total != null ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : formatBytes(downloaded);
          setLoadingDetails(`Downloaded ${sizeLabel}`);
        });
        if (!cancelled) {
          setPatch(rawPatch);
          setLoadedPatchBytes(metadata.patchBytes ?? byteLength(rawPatch));
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
    setCopyStatus('idle');
    setActiveCommitId(null);
    setCommitPatch(null);
  }, [response?.target]);

  useEffect(() => {
    setCollapsedIds(new Set());
    setReviews([]);
    setDraftReview(null);

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

  const activePatch = activeCommitId != null ? (commitPatch ?? '') : patch;
  const diffKey = response == null ? 'empty' : activeCommitId ?? response.target;
  const parsedPatches = useMemo(() => parseDiffPatch(activePatch, diffKey), [activePatch, diffKey]);
  const parsed = useMemo(() => createDiffProjection<ReviewAnnotation>({
    patches: parsedPatches,
    collapsedFileIds: collapsedIds,
    reviews,
    draftReview,
  }), [collapsedIds, draftReview, parsedPatches, reviews]);

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

    const targetLabel = response?.source === 'github'
      ? `GitHub pull request "${response.target}"`
      : response?.source === 'jj'
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
  const effectivePatchBytes = loadedPatchBytes ?? response?.patchBytes;
  const largeDiffLabel = getLargeDiffLabel(response?.source, effectivePatchBytes, parsed.stats.files);

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
      pendingTreeScrollFileIdRef.current = fileId;
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
    const fileId = pendingTreeScrollFileIdRef.current;
    if (fileId == null) {
      return;
    }

    const file = parsed.getFileById(fileId);
    if (file?.collapsed === true) {
      return;
    }
    const scrollTarget = parsed.getScrollTarget(fileId);
    if (scrollTarget == null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      viewerRef.current?.scrollTo({
        ...scrollTarget,
        align: 'start',
        behavior: 'smooth-auto',
      });
      pendingTreeScrollFileIdRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [parsed]);

  if (loadState === 'loading') {
    return <Shell message={loadingMessage} details={loadingDetails ?? undefined} />;
  }

  if (loadState === 'error') {
    return <Shell message="Could not render this diff" details={error ?? undefined} />;
  }

  return (
    <WorkerPoolContextProvider poolOptions={DIFF_WORKER_POOL_OPTIONS} highlighterOptions={DIFF_HIGHLIGHTER_OPTIONS}>
      <div className="app">
        <header className="toolbar">
          <div className="titleBlock">
            <div className="eyebrow">yadiff · {formatSource(response?.source)}</div>
            <h1>{response?.repositoryName} <span>{response?.target}</span></h1>
            {largeDiffLabel != null ? <div className="largeDiffBadge">{largeDiffLabel}</div> : null}
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
    </WorkerPoolContextProvider>
  );
}

async function fetchDiffMetadata(onStatus: (status: DiffStatusResponse) => void): Promise<DiffResponse> {
  const result = await fetch('/api/diff', { cache: 'no-store' });
  const data = (await result.json()) as DiffResponse | DiffStatusResponse;
  if (result.status === 202 || data.status === 'fetching') {
    onStatus(data as DiffStatusResponse);
    await pollUntilReady(onStatus);
    return fetchDiffMetadata(onStatus);
  }
  if (!result.ok || data.status === 'error') {
    throw new Error(data.error ?? `Request failed (${result.status})`);
  }
  return data as DiffResponse;
}

async function pollUntilReady(onStatus: (status: DiffStatusResponse) => void): Promise<void> {
  while (true) {
    await delay(500);
    const result = await fetch('/api/diff/status', { cache: 'no-store' });
    const data = (await result.json()) as DiffStatusResponse;
    if (!result.ok || data.status === 'error') {
      throw new Error(data.error ?? `Request failed (${result.status})`);
    }
    onStatus(data);
    if (data.status === 'ready') {
      return;
    }
  }
}

async function fetchPatchText(url: string, onProgress: (downloaded: number, total?: number) => void): Promise<string> {
  const result = await fetch(url, { cache: 'no-store' });
  if (!result.ok) {
    const details = await result.text();
    throw new Error(details || `Could not load raw diff (${result.status})`);
  }

  const totalHeader = result.headers.get('content-length');
  const total = totalHeader == null ? undefined : Number(totalHeader);
  if (result.body == null) {
    const text = await result.text();
    onProgress(byteLength(text), Number.isFinite(total) ? total : undefined);
    return text;
  }

  const reader = result.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let downloaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value == null) continue;
    downloaded += value.byteLength;
    onProgress(downloaded, Number.isFinite(total) ? total : undefined);
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatStatusDetails(status: DiffStatusResponse): string | null {
  if (status.status === 'fetching' && status.bytesDownloaded != null) {
    return `Downloaded ${formatBytes(status.bytesDownloaded)}`;
  }
  if (status.status === 'ready' && status.patchBytes != null) {
    return `Downloaded ${formatBytes(status.patchBytes)}`;
  }
  return null;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 1 : 2)} KB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} MB`;
}

function formatSource(source: Source | undefined): string {
  if (source === 'github') return 'GitHub';
  return source ?? 'unknown';
}

function getLargeDiffLabel(_source: Source | undefined, patchBytes: number | undefined, files: number): string | null {
  const isLarge = files >= 500 || (patchBytes != null && patchBytes >= 10 * 1024 * 1024);
  if (!isLarge) return null;
  const parts = ['Large diff'];
  if (files > 0) parts.push(`${files} files`);
  if (patchBytes != null) parts.push(formatBytes(patchBytes));
  return parts.join(' · ');
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
