import { useEffect, useRef } from 'react';

import { formatReviewSide } from '../format';
import type { DraftReview, LineReview } from '../types';

export function DraftReviewBox({
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
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    return (
        <div className="reviewAnnotation reviewDraft">
            <div className="reviewAnnotationMeta">{draft.path}:{draft.lineNumber} ({formatReviewSide(draft.side)})</div>
            <textarea
                ref={textareaRef}
                aria-label="Review comment"
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

export function SavedReviewAnnotation({ review, onDelete }: { review: LineReview; onDelete: () => void }) {
    return (
        <div className="reviewAnnotation">
            <div className="reviewAnnotationMeta">{review.path}:{review.lineNumber} ({formatReviewSide(review.side)})</div>
            <div className="reviewAnnotationBody">{review.body}</div>
            <button
                type="button"
                className="reviewAnnotationDelete"
                onClick={onDelete}
            >
                Delete
            </button>
        </div>
    );
}
