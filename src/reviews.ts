import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';

import type { DraftReview, Review, ReviewTarget, SavedReview } from './types';

const FILE_REVIEW_LINE = 0;

/** File-level reviews use 'additions' as a meaningless placeholder — only the line === 0 sentinel matters. */
const FILE_REVIEW_SIDE: AnnotationSide = 'additions';

export function isFileReviewTarget(target: ReviewTarget): boolean {
    return target.startLine === FILE_REVIEW_LINE && target.endLine === FILE_REVIEW_LINE;
}

export function createDraftReview({
    fileId,
    path,
    range,
}: {
    fileId: ReviewTarget['fileId'];
    path: string;
    range?: SelectedLineRange;
}): DraftReview {
    const target = createReviewTarget({ fileId, path, range });
    return {
        kind: 'draft',
        id: createDraftId(target),
        target,
        body: '',
    };
}

export function saveDraftReview(draft: DraftReview, nextId: number): SavedReview {
    return {
        kind: 'saved',
        id: `saved:${nextId}`,
        target: draft.target,
        body: draft.body.trim(),
    };
}

export function reviewMatchesFile(review: Review, fileId: ReviewTarget['fileId']): boolean {
    return review.target.fileId === fileId;
}

function createReviewTarget({
    fileId,
    path,
    range,
}: {
    fileId: ReviewTarget['fileId'];
    path: string;
    range?: SelectedLineRange;
}): ReviewTarget {
    if (range == null) {
        return { fileId, path, side: FILE_REVIEW_SIDE, startLine: FILE_REVIEW_LINE, endLine: FILE_REVIEW_LINE };
    }

    const side: AnnotationSide = range.side ?? 'additions';
    const [first, last] = range.start <= range.end ? [range.start, range.end] : [range.end, range.start];
    return { fileId, path, side, startLine: first, endLine: last };
}

function createDraftId(target: ReviewTarget): string {
    return `draft:${target.fileId}:${target.side}:${target.startLine}:${target.endLine}`;
}
