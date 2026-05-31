import { useEffect, useRef } from 'react';

import { formatReviewLocation } from '../format';
import type { DraftReview, SavedReview } from '../types';

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
            <div className="reviewAnnotationMeta">{formatReviewLocation(draft)}</div>
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

export function SavedReviewAnnotation({ review, onDelete }: { review: SavedReview; onDelete: () => void }) {
    return (
        <div className="reviewAnnotation">
            <div className="reviewAnnotationMeta">{formatReviewLocation(review)}</div>
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
