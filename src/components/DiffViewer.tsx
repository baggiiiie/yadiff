import { CodeView } from '@pierre/diffs/react';

import { REVIEW_UNSAFE_CSS } from '../constants';
import { normalizeReviewSide } from '../format';
import type { DiffViewerModel } from '../useDiffViewerModel';
import { useThemeContext } from '../useTheme';
import { DiffHeader } from './DiffHeader';
import { DraftReviewBox, SavedReviewAnnotation } from './ReviewAnnotations';

interface DiffViewerProps {
    activeCommitId: DiffViewerModel['activeCommitId'];
    diffStyle: DiffViewerModel['diffStyle'];
    lineNumbers: DiffViewerModel['lineNumbers'];
    nextReviewIdRef: DiffViewerModel['nextReviewIdRef'];
    overflow: DiffViewerModel['overflow'];
    parsed: DiffViewerModel['parsed'];
    response: DiffViewerModel['response'];
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
    lineNumbers,
    nextReviewIdRef,
    overflow,
    parsed,
    response,
    setCollapsedIds,
    setCopyStatus,
    setDraftReview,
    setReviews,
    showBackgrounds,
    viewerRef,
    viewerScrollTopRef,
}: DiffViewerProps) {
    const { resolved: resolvedTheme } = useThemeContext();
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
                        enableLineSelection: false,
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
                            const side = normalizeReviewSide(range.endSide ?? range.side);
                            const lineNumber = range.end;
                            setDraftReview({
                                kind: 'draft',
                                id: `draft:${file.id}:${side}:${lineNumber}`,
                                fileId: file.id,
                                path: file.path,
                                lineNumber,
                                side,
                                body: '',
                            });
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
                                    onSave={() => {
                                        const body = review.body.trim();
                                        if (body.length === 0) {
                                            return;
                                        }
                                        setReviews((current) => [
                                            ...current,
                                            {
                                                kind: 'saved',
                                                id: `${review.fileId}:${review.side}:${review.lineNumber}:${nextReviewIdRef.current++}`,
                                                fileId: review.fileId,
                                                path: review.path,
                                                lineNumber: review.lineNumber,
                                                side: review.side,
                                                body,
                                            },
                                        ]);
                                        setDraftReview(null);
                                    }}
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
                        return (
                            <DiffHeader
                                file={file}
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
