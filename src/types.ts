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

export interface ReviewTarget {
    fileId: ProjectedFileIdentity;
    path: string;
    side: AnnotationSide;
    startLine: number;
    endLine: number;
}

interface ReviewBase {
    id: string;
    target: ReviewTarget;
    body: string;
}

export type SavedReview = ReviewBase & { kind: 'saved' };
export type DraftReview = ReviewBase & { kind: 'draft' };
export type Review = SavedReview | DraftReview;
