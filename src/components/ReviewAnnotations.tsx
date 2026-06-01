import { useEffect, useRef, useState } from 'react';

import { formatReviewLocation } from '../format';
import type { DraftReview, Review, SavedReview } from '../types';

function ReviewEditor({
    review,
    autoFocus,
    initialBody,
    placeholder,
    saveLabel,
    onSave,
    onCancel,
}: {
    review: Review;
    autoFocus: boolean;
    initialBody: string;
    placeholder?: string;
    saveLabel: string;
    onSave: (body: string) => void;
    onCancel: () => void;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [localBody, setLocalBody] = useState(initialBody);

    useEffect(() => {
        if (autoFocus && textareaRef.current != null) {
            const el = textareaRef.current;
            el.focus();
            el.selectionStart = el.selectionEnd = el.value.length;
        }
    }, [autoFocus]);

    return (
        <div className="reviewAnnotation reviewDraft">
            <div className="reviewAnnotationMeta">{formatReviewLocation(review)}</div>
            <textarea
                ref={textareaRef}
                aria-label={placeholder ?? 'Review comment'}
                className="reviewTextarea"
                placeholder={placeholder}
                value={localBody}
                onChange={(event) => setLocalBody(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && localBody.trim().length > 0) {
                        event.preventDefault();
                        onSave(localBody);
                    }
                }}
            />
            <div className="reviewDraftActions">
                <button type="button" className="reviewSaveButton" onClick={() => onSave(localBody)} disabled={localBody.trim().length === 0}>
                    {saveLabel} ↵
                </button>
                <button type="button" className="reviewCancelButton" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

export function DraftReviewBox({
    draft,
    onCancel,
    onSave,
}: {
    draft: DraftReview;
    onCancel: () => void;
    onSave: (body: string) => void;
}) {
    return (
        <ReviewEditor
            key={draft.id}
            review={draft}
            autoFocus
            initialBody={draft.body}
            placeholder="Leave a review comment"
            saveLabel="Add review"
            onSave={onSave}
            onCancel={onCancel}
        />
    );
}

export function SavedReviewAnnotation({ review, onDelete, onEdit }: { review: SavedReview; onDelete: () => void; onEdit: (body: string) => void }) {
    const [editing, setEditing] = useState(false);

    if (editing) {
        return (
            <ReviewEditor
                key={review.id}
                review={review}
                autoFocus
                initialBody={review.body}
                saveLabel="Save"
                onSave={(body) => { onEdit(body); setEditing(false); }}
                onCancel={() => setEditing(false)}
            />
        );
    }

    return (
        <div className="reviewAnnotation">
            <div className="reviewAnnotationMeta">{formatReviewLocation(review)}</div>
            <div className="reviewAnnotationBody">{review.body}</div>
            <div className="reviewAnnotationActions">
                <button
                    type="button"
                    className="reviewAnnotationEdit"
                    onClick={() => setEditing(true)}
                >
                    Edit
                </button>
                <button
                    type="button"
                    className="reviewAnnotationDelete"
                    onClick={onDelete}
                >
                    Delete
                </button>
            </div>
        </div>
    );
}
