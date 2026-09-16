import { useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

import type { ProjectedFile } from '../diffProjection';
import type { DraftReview, FileLinks, SavedReview } from '../types';
import { useDismissablePopover } from '../useDismissablePopover';
import { DraftReviewBox, SavedReviewAnnotation } from './ReviewAnnotations';

/** Room needed below the toggle for the menu to open downward instead of upward. */
const MENU_SPACE_BELOW = 200;

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
    fileLinks,
    fileReviews,
    onToggle,
}: {
    actions: FileReviewActions;
    draftReview: DraftReview | null;
    file: ProjectedFile;
    fileLinks: FileLinks;
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
                    <FileActionsMenu
                        links={fileLinks}
                        onReviewFile={actions.onReviewFile}
                        path={file.path}
                    />
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

/**
 * File actions live behind a single menu button so the file name keeps the header's
 * horizontal space, and so new actions stay cheap to add.
 */
function FileActionsMenu({
    links,
    onReviewFile,
    path,
}: {
    links: FileLinks;
    onReviewFile: () => void;
    path: string;
}) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const menuRef = useDismissablePopover({
        anchorRef: toggleRef,
        closeOnScroll: true,
        onClose: () => setOpen(false),
        open,
    });

    const closeMenu = () => setOpen(false);

    const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
        if (open) {
            setOpen(false);
            return;
        }

        // The menu is portaled to the body, so it is positioned from the button's viewport
        // rect. Portaling is required because each file item is its own stacking context
        // (the diff container sets `contain: layout`), so no z-index keeps a menu inside the
        // header above the next file's content.
        const rect = event.currentTarget.getBoundingClientRect();
        const right = Math.max(window.innerWidth - rect.right, 0);
        setPosition(window.innerHeight - rect.bottom < MENU_SPACE_BELOW
            ? { bottom: window.innerHeight - rect.top + 6, right }
            : { top: rect.bottom + 6, right });
        setOpen(true);
    };

    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(path);
            setCopied(true);
            // Keep the menu open so the confirmation is actually visible.
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="fileActionsMenu">
            <button
                ref={toggleRef}
                type="button"
                className="fileReviewButton fileMenuToggle"
                aria-expanded={open}
                aria-label="File actions"
                onClick={toggleMenu}
                title="File actions"
            >
                <span aria-hidden="true">⋯</span>
            </button>
            {open && position != null ? createPortal(
                <div className="fileMenu" style={position} ref={menuRef} aria-label="File actions">
                    <button type="button" className="fileMenuItem" onClick={onCopy}>
                        {copied ? 'Copied' : 'Copy file name'}
                    </button>
                    <FileMenuLink
                        hint={links.hint}
                        href={links.href}
                        onOpen={closeMenu}
                        title="Open the full file, read-only, in a new tab"
                    >
                        View file
                    </FileMenuLink>
                    <FileMenuLink
                        hint={links.hint}
                        href={links.rawHref}
                        onOpen={closeMenu}
                        title="Open the raw file contents in a new tab, with no highlighting"
                    >
                        Open raw file
                    </FileMenuLink>
                    <button
                        type="button"
                        className="fileMenuItem"
                        onClick={() => {
                            onReviewFile();
                            setOpen(false);
                        }}
                    >
                        Review file
                    </button>
                </div>,
                document.body
            ) : null}
        </div>
    );
}

/**
 * Menu entry that opens a file in a new tab. When the link is unavailable the entry is
 * disabled and explains why, so the action stays discoverable instead of disappearing.
 */
function FileMenuLink({
    children,
    hint,
    href,
    onOpen,
    title,
}: {
    children: string;
    hint: string | null;
    href: string | null;
    onOpen: () => void;
    title: string;
}) {
    if (href == null) {
        return (
            <button type="button" className="fileMenuItem" disabled title={hint ?? undefined}>
                {children}
            </button>
        );
    }

    return (
        <a
            className="fileMenuItem"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            onClick={onOpen}
        >
            {children}
        </a>
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
