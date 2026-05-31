import { WorkerPoolContextProvider } from '@pierre/diffs/react';

import { DIFF_HIGHLIGHTER_OPTIONS, DIFF_WORKER_POOL_OPTIONS } from '../constants';
import type { DiffViewerModel } from '../useDiffViewerModel';
import { DiffViewer } from './DiffViewer';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';

export function ReadyDiffView({ model }: { model: DiffViewerModel }) {
    const {
        activeCommitId,
        allCollapsed,
        copyReviews,
        copyStatus,
        diffStyle,
        largeDiffLabel,
        lineNumbers,
        nextReviewIdRef,
        overflow,
        parsed,
        response,
        reviewButtonLabel,
        selectCommit,
        setCollapsedIds,
        setCopyStatus,
        setDiffStyle,
        setDraftReview,
        setLineNumbers,
        setOverflow,
        setReviews,
        setShowBackgrounds,
        setShowShortcuts,
        showBackgrounds,
        showShortcuts,
        toggleAllCollapsed,
        treeModel,
        viewerRef,
        viewerScrollTopRef,
    } = model;

    return (
        <WorkerPoolContextProvider poolOptions={DIFF_WORKER_POOL_OPTIONS} highlighterOptions={DIFF_HIGHLIGHTER_OPTIONS}>
            <div className="app">
                <Toolbar
                    allCollapsed={allCollapsed}
                    copyReviews={copyReviews}
                    copyStatus={copyStatus}
                    diffStyle={diffStyle}
                    largeDiffLabel={largeDiffLabel}
                    lineNumbers={lineNumbers}
                    overflow={overflow}
                    response={response}
                    reviewButtonLabel={reviewButtonLabel}
                    setDiffStyle={setDiffStyle}
                    setLineNumbers={setLineNumbers}
                    setOverflow={setOverflow}
                    setShowBackgrounds={setShowBackgrounds}
                    setShowShortcuts={setShowShortcuts}
                    showBackgrounds={showBackgrounds}
                    showShortcuts={showShortcuts}
                    toggleAllCollapsed={toggleAllCollapsed}
                />

                <Sidebar
                    activeCommitId={activeCommitId}
                    parsed={parsed}
                    response={response}
                    selectCommit={selectCommit}
                    treeModel={treeModel}
                />

                <DiffViewer
                    activeCommitId={activeCommitId}
                    diffStyle={diffStyle}
                    lineNumbers={lineNumbers}
                    nextReviewIdRef={nextReviewIdRef}
                    overflow={overflow}
                    parsed={parsed}
                    response={response}
                    setCollapsedIds={setCollapsedIds}
                    setCopyStatus={setCopyStatus}
                    setDraftReview={setDraftReview}
                    setReviews={setReviews}
                    showBackgrounds={showBackgrounds}
                    viewerRef={viewerRef}
                    viewerScrollTopRef={viewerScrollTopRef}
                />
            </div>
        </WorkerPoolContextProvider>
    );
}
