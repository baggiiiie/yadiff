import { useState } from 'react';
import type { ProjectedFile } from '../diffProjection';
import type { DraftReview, SavedReview } from '../types';
import { DraftReviewBox, SavedReviewAnnotation } from './ReviewAnnotations';

export interface FileReviewActions {
    onDeleteReview: (id: string) => void;
    onDraftCancel: (id: string) => void;
    onDraftSave: (draft: DraftReview, body: string) => void;
    onEditReview: (id: string, body: string) => void;
    onReviewFile: () => void;
}

export function DiffHeader({
    actions,
    draftReview,
    file,
    fileReviews,
    onToggle,
}: {
    actions: FileReviewActions;
    draftReview: DraftReview | null;
    file: ProjectedFile;
    fileReviews: SavedReview[];
    onToggle: () => void;
}) {
    const hasFileReviewThread = draftReview != null || fileReviews.length > 0;

    return (
        <div className="customFileHeaderFrame">
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
                <div className="fileHeaderActions">
                    <FileActions path={file.path} />
                    <FileReviewControls onReviewFile={actions.onReviewFile} />
                    <FileMeta file={file} />
                </div>
            </div>
            {hasFileReviewThread ? (
                <div className="fileReviewThread">
                    {fileReviews.map((review) => (
                        <SavedReviewAnnotation
                            key={review.id}
                            review={review}
                            onDelete={() => actions.onDeleteReview(review.id)}
                            onEdit={(body) => actions.onEditReview(review.id, body)}
                        />
                    ))}
                    {draftReview != null ? (
                        <DraftReviewBox
                            draft={draftReview}
                            onCancel={() => actions.onDraftCancel(draftReview.id)}
                            onSave={(body) => actions.onDraftSave(draftReview, body)}
                        />
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function FileActions({ path }: { path: string }) {
    const [copied, setCopied] = useState(false);

    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(path);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="fileActions">
            <button
                type="button"
                className="fileReviewButton"
                onClick={onCopy}
                title="Copy file name"
            >
                {copied ? 'Copied' : 'Copy file name'}
            </button>
        </div>
    );
}

function FileReviewControls({ onReviewFile }: { onReviewFile: () => void }) {
    return (
        <div className="fileReviewControls">
            <button type="button" className="fileReviewButton" onClick={onReviewFile}>
                Review file
            </button>
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
