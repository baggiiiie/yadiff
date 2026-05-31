import { CodeView } from '@pierre/diffs/react';
import { useMemo } from 'react';

import { REVIEW_UNSAFE_CSS } from '../constants';
import type { ProjectedFileIdentity } from '../diffProjection';
import { createDraftReview, isFileReviewTarget, reviewMatchesFile, saveDraftReview } from '../reviews';
import type { DiffViewerModel } from '../useDiffViewerModel';
import type { SavedReview } from '../types';
import { useThemeContext } from '../useTheme';
import { DiffHeader } from './DiffHeader';
import { DraftReviewBox, SavedReviewAnnotation } from './ReviewAnnotations';

interface DiffViewerProps {
    activeCommitId: DiffViewerModel['activeCommitId'];
    diffStyle: DiffViewerModel['diffStyle'];
    draftReview: DiffViewerModel['draftReview'];
    lineNumbers: DiffViewerModel['lineNumbers'];
    nextReviewIdRef: DiffViewerModel['nextReviewIdRef'];
    overflow: DiffViewerModel['overflow'];
    parsed: DiffViewerModel['parsed'];
    response: DiffViewerModel['response'];
    reviews: DiffViewerModel['reviews'];
    setCollapsedIds: DiffViewerModel['setCollapsedIds'];
    setCopyStatus: DiffViewerModel['setCopyStatus'];
    setDraftReview: DiffViewerModel['setDraftReview'];
    setReviews: DiffViewerModel['setReviews'];
    showBackgrounds: DiffViewerModel['showBackgrounds'];
    viewerRef: DiffViewerModel['viewerRef'];
    viewerScrollTopRef: DiffViewerModel['viewerScrollTopRef'];
}

export function DiffViewer({
    activeCommitId,
    diffStyle,
    draftReview,
    lineNumbers,
    nextReviewIdRef,
    overflow,
    parsed,
    response,
    reviews,
    setCollapsedIds,
    setCopyStatus,
    setDraftReview,
    setReviews,
    showBackgrounds,
    viewerRef,
    viewerScrollTopRef,
}: DiffViewerProps) {
    const { resolved: resolvedTheme } = useThemeContext();
    const saveDraft = (draft: NonNullable<DiffViewerModel['draftReview']>) => {
        if (draft.body.trim().length === 0) {
            return;
        }
        setReviews((current) => [...current, saveDraftReview(draft, nextReviewIdRef.current++)]);
        setDraftReview(null);
    };

    const fileReviewIndex = useMemo(() => {
        const index = new Map<ProjectedFileIdentity, SavedReview[]>();
        for (const review of reviews) {
            if (!isFileReviewTarget(review.target)) continue;
            const list = index.get(review.target.fileId);
            if (list != null) {
                list.push(review);
            } else {
                index.set(review.target.fileId, [review]);
            }
        }
        return index;
    }, [reviews]);

    return (
        <main className="viewer">
            {parsed.codeViewItems.length === 0 ? (
                <div className="empty">No patch content found for this target.</div>
            ) : (
                <CodeView
                    ref={viewerRef}
                    key={`${response?.target}:${activeCommitId ?? 'combined'}`}
                    items={parsed.codeViewItems}
                    className="codeView"
                    onScroll={(scrollTop) => {
                        viewerScrollTopRef.current = scrollTop;
                    }}
                    options={{
                        diffStyle,
                        overflow,
                        themeType: resolvedTheme,
                        disableLineNumbers: !lineNumbers,
                        disableBackground: !showBackgrounds,
                        diffIndicators: 'bars',
                        hunkSeparators: 'line-info',
                        collapsedContextThreshold: 2,
                        expansionLineCount: 50,
                        lineHoverHighlight: 'both',
                        enableGutterUtility: true,
                        enableLineSelection: true,
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
                            setDraftReview(createDraftReview({
                                fileId: file.id,
                                path: file.path,
                                range,
                            }));
                            viewerRef.current?.clearSelectedLines();
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
                                    onSave={() => saveDraft(review)}
                                />
                            );
                        }
                        return (
                            <SavedReviewAnnotation
                                review={review}
                                onDelete={() => setReviews((current) => current.filter((item) => item.id !== review.id))}
                            />
                        );
                    }}
                    renderCustomHeader={(item) => {
                        if (item.type !== 'diff') return null;
                        const file = parsed.getFileForCodeViewItem(item);
                        if (file == null) return null;
                        const fileReviews = fileReviewIndex.get(file.id) ?? [];
                        const fileDraftReview = draftReview != null && isFileReviewTarget(draftReview.target) && reviewMatchesFile(draftReview, file.id) ? draftReview : null;
                        return (
                            <DiffHeader
                                actions={{
                                    onDeleteReview: (id) => setReviews((current) => current.filter((review) => review.id !== id)),
                                    onDraftCancel: (id) => setDraftReview((current) => current?.id === id ? null : current),
                                    onDraftChange: (id, body) => setDraftReview((current) => current?.id === id ? { ...current, body } : current),
                                    onDraftSave: saveDraft,
                                    onReviewFile: () => {
                                        setDraftReview(createDraftReview({ fileId: file.id, path: file.path }));
                                        setCopyStatus('idle');
                                    },
                                }}
                                draftReview={fileDraftReview}
                                file={file}
                                fileReviews={fileReviews}
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
    );
}
