import type { AnnotationSide } from '@pierre/diffs';

import type { ProjectedFileIdentity } from './diffProjection';

export type DiffStyle = 'split' | 'unified';
export type Overflow = 'scroll' | 'wrap';
export type LoadState = 'loading' | 'ready' | 'error';
export type Source = 'git' | 'jj' | 'github';

export interface DiffResponse {
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

export interface DiffStatusResponse {
    status: 'fetching' | 'ready' | 'error';
    source: Source;
    bytesDownloaded?: number;
    patchBytes?: number;
    error?: string;
}

export interface CommitInfo {
    id: string;
    shortId: string;
    message: string;
}

export interface FileStats {
    additions: number;
    deletions: number;
    files: number;
}

export interface LineReview {
    kind: 'saved';
    id: string;
    fileId: ProjectedFileIdentity;
    path: string;
    lineNumber: number;
    side: AnnotationSide;
    body: string;
}

export interface DraftReview {
    kind: 'draft';
    id: string;
    fileId: ProjectedFileIdentity;
    path: string;
    lineNumber: number;
    side: AnnotationSide;
    body: string;
}

export type ReviewAnnotation = LineReview | DraftReview;
