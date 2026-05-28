import {
  parsePatchFiles,
  type AnnotationSide,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewItemScrollTarget,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type ParsedPatch,
} from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';

const projectedFileIdentityBrand: unique symbol = Symbol('ProjectedFileIdentity');

export type ProjectedFileIdentity = string & { readonly [projectedFileIdentityBrand]: true };
export type ProjectedChangeType = 'new' | 'deleted' | 'renamed' | 'modified';

export interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
}

export interface ProjectedFile {
  id: ProjectedFileIdentity;
  path: string;
  previousPath?: string;
  changeType: ProjectedChangeType;
  additions: number;
  deletions: number;
  collapsed: boolean;
}

export interface DiffProjectionReview {
  id: string;
  path: string;
  lineNumber: number;
  side: AnnotationSide;
  fileId?: ProjectedFileIdentity;
  body?: string;
  kind?: string;
}

export interface CreateDiffProjectionInput<TReview extends DiffProjectionReview> {
  patches: readonly ParsedPatch[];
  collapsedFileIds: ReadonlySet<ProjectedFileIdentity>;
  reviews: readonly TReview[];
  draftReview: TReview | null;
}

export interface DiffProjection<TReview extends DiffProjectionReview> {
  /** Opaque render input for CodeView. Callers should pass it through, not inspect parser metadata. */
  codeViewItems: CodeViewItem<TReview>[];
  files: ProjectedFile[];
  paths: string[];
  stats: DiffStats;
  gitStatus: GitStatusEntry[];
  getFileById(id: ProjectedFileIdentity): ProjectedFile | undefined;
  getFileIdByPath(path: string): ProjectedFileIdentity | undefined;
  getFileForCodeViewItem(item: CodeViewDiffItem<TReview>): ProjectedFile | undefined;
  getScrollTarget(fileId: ProjectedFileIdentity): CodeViewItemScrollTarget | undefined;
}

export function parseDiffPatch(patch: string, diffKey: string): ParsedPatch[] {
  return parsePatchFiles(patch, encodeURIComponent(diffKey));
}

export function createDiffProjection<TReview extends DiffProjectionReview>({
  patches,
  collapsedFileIds,
  reviews,
  draftReview,
}: CreateDiffProjectionInput<TReview>): DiffProjection<TReview> {
  const items: CodeViewItem<TReview>[] = [];
  const files: ProjectedFile[] = [];
  const paths: string[] = [];
  const fileIdByPath = new Map<string, ProjectedFileIdentity>();
  const fileById = new Map<ProjectedFileIdentity, ProjectedFile>();
  const fileByRendererItemId = new Map<string, ProjectedFile>();
  const rendererItemIdByFileId = new Map<ProjectedFileIdentity, string>();
  const gitStatus: GitStatusEntry[] = [];
  const stats: DiffStats = { additions: 0, deletions: 0, files: 0 };

  for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
    const parsedPatch = patches[patchIndex];
    for (let fileIndex = 0; fileIndex < parsedPatch.files.length; fileIndex++) {
      const fileDiff = parsedPatch.files[fileIndex];
      const path = getProjectedPath(fileDiff, patchIndex, fileIndex);
      const fileId = createProjectedFileIdentity(patchIndex, fileIndex, path);
      const rendererItemId = String(fileId);
      const additions = countAdditions(fileDiff);
      const deletions = countDeletions(fileDiff);
      const collapsed = collapsedFileIds.has(fileId);
      const projectedFile: ProjectedFile = {
        id: fileId,
        path,
        previousPath: fileDiff.prevName,
        changeType: projectChangeType(fileDiff),
        additions,
        deletions,
        collapsed,
      };
      const annotations = getAnnotations(projectedFile, reviews, draftReview);

      files.push(projectedFile);
      paths.push(path);
      fileIdByPath.set(path, fileId);
      fileById.set(fileId, projectedFile);
      fileByRendererItemId.set(rendererItemId, projectedFile);
      rendererItemIdByFileId.set(fileId, rendererItemId);
      gitStatus.push({ path, status: statusForFile(fileDiff) });
      stats.files++;
      stats.additions += additions;
      stats.deletions += deletions;

      items.push({
        id: rendererItemId,
        type: 'diff',
        fileDiff,
        annotations,
        collapsed,
        version: getItemVersion(collapsed, annotations),
      } satisfies CodeViewDiffItem<TReview>);
    }
  }

  return {
    codeViewItems: items,
    files,
    paths: Array.from(new Set(paths)),
    stats,
    gitStatus,
    getFileById(id) {
      return fileById.get(id);
    },
    getFileIdByPath(path) {
      return fileIdByPath.get(path);
    },
    getFileForCodeViewItem(item) {
      return fileByRendererItemId.get(item.id);
    },
    getScrollTarget(fileId) {
      const rendererItemId = rendererItemIdByFileId.get(fileId);
      if (rendererItemId == null) {
        return undefined;
      }
      return { type: 'item', id: rendererItemId };
    },
  };
}

function createProjectedFileIdentity(
  patchIndex: number,
  fileIndex: number,
  path: string
): ProjectedFileIdentity {
  return `diff:${patchIndex}:${fileIndex}:${path}` as ProjectedFileIdentity;
}

function getProjectedPath(file: FileDiffMetadata, patchIndex: number, fileIndex: number): string {
  return file.name || file.prevName || `unknown-${patchIndex}-${fileIndex}`;
}

function getAnnotations<TReview extends DiffProjectionReview>(
  file: ProjectedFile,
  reviews: readonly TReview[],
  draftReview: TReview | null
): DiffLineAnnotation<TReview>[] {
  const annotations = reviews
    .filter((review) => reviewMatchesFile(review, file))
    .map((review) => createAnnotation(review));

  if (draftReview != null && reviewMatchesFile(draftReview, file)) {
    annotations.push(createAnnotation(draftReview));
  }

  return annotations;
}

function createAnnotation<TReview extends DiffProjectionReview>(review: TReview): DiffLineAnnotation<TReview> {
  // @pierre/diffs uses a conditional metadata type to support undefined metadata.
  // Diff Projection reviews always carry metadata, so keep the cast local to this adapter point.
  return {
    side: review.side,
    lineNumber: review.lineNumber,
    metadata: review,
  } as unknown as DiffLineAnnotation<TReview>;
}

function reviewMatchesFile(review: DiffProjectionReview, file: ProjectedFile): boolean {
  return review.fileId != null ? review.fileId === file.id : review.path === file.path;
}

function getItemVersion<TReview extends DiffProjectionReview>(
  isCollapsed: boolean,
  annotations: readonly DiffLineAnnotation<TReview>[]
): number {
  let hash = isCollapsed ? 17 : 31;
  for (const annotation of annotations) {
    const metadata = annotation.metadata;
    hash = hashNumber(hash, annotation.lineNumber);
    hash = hashString(hash, annotation.side);
    if (metadata != null) {
      hash = hashString(hash, metadata.id);
      hash = hashString(hash, metadata.body ?? '');
      hash = hashString(hash, metadata.kind ?? '');
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

function projectChangeType(file: FileDiffMetadata): ProjectedChangeType {
  if (file.type === 'new') return 'new';
  if (file.type === 'deleted') return 'deleted';
  if (file.type === 'rename-pure' || file.type === 'rename-changed') return 'renamed';
  return 'modified';
}

function statusForFile(file: FileDiffMetadata): GitStatusEntry['status'] {
  if (file.type === 'new') return 'added';
  if (file.type === 'deleted') return 'deleted';
  if (file.type === 'rename-pure' || file.type === 'rename-changed') return 'renamed';
  return 'modified';
}

function countAdditions(file: FileDiffMetadata): number {
  return file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
}

function countDeletions(file: FileDiffMetadata): number {
  return file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
}
