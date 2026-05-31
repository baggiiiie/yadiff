import type { CodeViewHandle } from '@pierre/diffs/react';
import { useFileTree, useFileTreeSearch } from '@pierre/trees/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
    createDiffProjection,
    parseDiffPatch,
    type ProjectedFileIdentity,
} from './diffProjection';
import { fetchCommitPatchText, fetchDiffMetadata, fetchPatchText } from './diffClient';
import {
    byteLength,
    formatBytes,
    formatCopyStatus,
    formatReviewLocation,
    formatStatusDetails,
    getLargeDiffLabel,
} from './format';
import { isFileReviewTarget } from './reviews';
import type { DiffResponse, DiffStyle, DraftReview, LoadState, Overflow, Review, SavedReview } from './types';
import { increment, modulo } from './utils';

function useAppState() {
    const [loadState, setLoadState] = useState<LoadState>('loading');
    const [loadingMessage, setLoadingMessage] = useState('Fetching diff from local repository…');
    const [loadingDetails, setLoadingDetails] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [response, setResponse] = useState<DiffResponse | null>(null);
    const [patch, setPatch] = useState('');
    const [loadedPatchBytes, setLoadedPatchBytes] = useState<number | undefined>(undefined);
    const [diffStyle, setDiffStyle] = useState<DiffStyle>(() =>
        window.matchMedia('(max-width: 800px)').matches ? 'unified' : 'split'
    );
    const [overflow, setOverflow] = useState<Overflow>('scroll');
    const [showBackgrounds, setShowBackgrounds] = useState(true);
    const [lineNumbers, setLineNumbers] = useState(true);
    const [collapsedIds, setCollapsedIds] = useState<Set<ProjectedFileIdentity>>(() => new Set());
    const [reviews, setReviews] = useState<SavedReview[]>([]);
    const [draftReview, setDraftReview] = useState<DraftReview | null>(null);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'empty' | 'error'>('idle');
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [activeCommitId, setActiveCommitId] = useState<string | null>(null);
    const [commitPatch, setCommitPatch] = useState<string | null>(null);

    return {
        activeCommitId,
        collapsedIds,
        commitPatch,
        copyStatus,
        diffStyle,
        draftReview,
        error,
        lineNumbers,
        loadedPatchBytes,
        loadingDetails,
        loadingMessage,
        loadState,
        overflow,
        patch,
        response,
        reviews,
        setActiveCommitId,
        setCollapsedIds,
        setCommitPatch,
        setCopyStatus,
        setDiffStyle,
        setDraftReview,
        setError,
        setLineNumbers,
        setLoadedPatchBytes,
        setLoadingDetails,
        setLoadingMessage,
        setLoadState,
        setOverflow,
        setPatch,
        setResponse,
        setReviews,
        setShowBackgrounds,
        setShowShortcuts,
        showBackgrounds,
        showShortcuts,
    };
}

export function useDiffViewerModel() {
    const {
        activeCommitId,
        collapsedIds,
        commitPatch,
        copyStatus,
        diffStyle,
        draftReview,
        error,
        lineNumbers,
        loadedPatchBytes,
        loadingDetails,
        loadingMessage,
        loadState,
        overflow,
        patch,
        response,
        reviews,
        setActiveCommitId,
        setCollapsedIds,
        setCommitPatch,
        setCopyStatus,
        setDiffStyle,
        setDraftReview,
        setError,
        setLineNumbers,
        setLoadedPatchBytes,
        setLoadingDetails,
        setLoadingMessage,
        setLoadState,
        setOverflow,
        setPatch,
        setResponse,
        setReviews,
        setShowBackgrounds,
        setShowShortcuts,
        showBackgrounds,
        showShortcuts,
    } = useAppState();
    const pendingTreeScrollFileIdRef = useRef<ProjectedFileIdentity | null>(null);
    const shortcutScopeRef = useRef<HTMLDivElement>(null);
    const viewerScrollTopRef = useRef(0);
    const activeFileIndexRef = useRef(0);
    const [scrollTrigger, triggerScroll] = useReducer(increment, 0);
    const viewerRef = useRef<CodeViewHandle<Review>>(null);
    const nextReviewIdRef = useRef(0);
    const commitRequestIdRef = useRef(0);
    const onTreeSelectionRef = useRef<(paths: readonly string[]) => void>(() => undefined);
    const { model: treeModel } = useFileTree({
        paths: [],
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        onSelectionChange(paths) {
            onTreeSelectionRef.current(paths);
        },
        search: true,
        stickyFolders: true,
    });
    const treeSearch = useFileTreeSearch(treeModel);

    useEffect(() => {
        const session = new EventSource('/api/session');
        return () => {
            session.close();
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoadState('loading');
            setLoadingMessage('Fetching diff from local repository…');
            setLoadingDetails(null);
            setError(null);
            try {
                const metadata = await fetchDiffMetadata((status) => {
                    if (cancelled) return;
                    setLoadingMessage(status.source === 'github'
                        ? 'Fetching GitHub pull request diff…'
                        : 'Fetching diff from local repository…');
                    setLoadingDetails(formatStatusDetails(status));
                });
                if (cancelled) return;

                commitRequestIdRef.current += 1;
                setCopyStatus('idle');
                setActiveCommitId(null);
                setCommitPatch(null);
                setResponse(metadata);
                setLoadingMessage('Loading diff into browser…');
                setLoadingDetails(metadata.patchBytes != null ? `Diff size: ${formatBytes(metadata.patchBytes)}` : null);
                const rawPatch = await fetchPatchText(metadata.patchUrl, (downloaded, total) => {
                    if (cancelled) return;
                    const sizeLabel = total != null ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : formatBytes(downloaded);
                    setLoadingDetails(`Downloaded ${sizeLabel}`);
                });
                if (!cancelled) {
                    setPatch(rawPatch);
                    setLoadedPatchBytes(metadata.patchBytes ?? byteLength(rawPatch));
                    setLoadState('ready');
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : String(loadError));
                    setLoadState('error');
                }
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [
        setActiveCommitId,
        setCommitPatch,
        setCopyStatus,
        setError,
        setLoadedPatchBytes,
        setLoadingDetails,
        setLoadingMessage,
        setLoadState,
        setPatch,
        setResponse,
    ]);

    const selectCommit = useCallback((commitId: string | null) => {
        const requestId = commitRequestIdRef.current + 1;
        commitRequestIdRef.current = requestId;
        setActiveCommitId(commitId);
        setCollapsedIds(new Set());
        setReviews([]);
        setDraftReview(null);
        setCopyStatus('idle');

        if (commitId == null) {
            setCommitPatch(null);
            return;
        }

        setCommitPatch(null);
        void fetchCommitPatchText(commitId).then((nextPatch) => {
            if (commitRequestIdRef.current === requestId) {
                setCommitPatch(nextPatch);
            }
        }, () => {
            if (commitRequestIdRef.current === requestId) {
                setCommitPatch(null);
            }
        });
    }, [setActiveCommitId, setCollapsedIds, setCommitPatch, setCopyStatus, setDraftReview, setReviews]);

    const activePatch = activeCommitId != null ? (commitPatch ?? '') : patch;
    const diffKey = response == null ? 'empty' : activeCommitId ?? response.target;
    const parsedPatches = useMemo(() => parseDiffPatch(activePatch, diffKey), [activePatch, diffKey]);
    const renderedLineReviews = useMemo(() => reviews.filter((review) => !isFileReviewTarget(review.target)), [reviews]);
    const renderedLineDraftReview = draftReview != null && !isFileReviewTarget(draftReview.target) ? draftReview : null;
    const parsed = useMemo(() => createDiffProjection<Review>({
        patches: parsedPatches,
        collapsedFileIds: collapsedIds,
        reviews: renderedLineReviews,
        draftReview: renderedLineDraftReview,
    }), [collapsedIds, renderedLineDraftReview, renderedLineReviews, parsedPatches]);

    const allCollapsed = parsed.files.length > 0 && parsed.files.every((file) => collapsedIds.has(file.id));
    const toggleAllCollapsed = useCallback(() => {
        setCollapsedIds(allCollapsed ? new Set() : new Set(parsed.files.map((file) => file.id)));
    }, [allCollapsed, parsed.files, setCollapsedIds]);

    const showCopyStatus = useCallback((status: 'copied' | 'empty' | 'error') => {
        setCopyStatus(status);
        window.setTimeout(() => setCopyStatus('idle'), status === 'error' ? 2000 : 1500);
    }, [setCopyStatus]);

    const copyReviews = useCallback(async () => {
        if (reviews.length === 0) {
            showCopyStatus('empty');
            return;
        }

        const header = "Below is my review";
        const body = reviews
            .map((review, index) => `${index + 1}. ${formatReviewLocation(review)}\n   ${review.body}`)
            .join('\n');
        const text = `${header}\n${body}`;
        try {
            await navigator.clipboard.writeText(text);
            showCopyStatus('copied');
        } catch {
            showCopyStatus('error');
        }
    }, [reviews, showCopyStatus]);

    const reviewButtonLabel = copyStatus === 'idle' ? `${reviews.length} Reviews (Y)` : formatCopyStatus(copyStatus);
    const effectivePatchBytes = loadedPatchBytes ?? response?.patchBytes;
    const largeDiffLabel = getLargeDiffLabel(response?.source, effectivePatchBytes, parsed.stats.files);

    const scrollToFile = useCallback((fileId: ProjectedFileIdentity) => {
        const nextIndex = parsed.files.findIndex((file) => file.id === fileId);
        if (nextIndex >= 0) {
            activeFileIndexRef.current = nextIndex;
        }
        pendingTreeScrollFileIdRef.current = fileId;
        triggerScroll();
        setCollapsedIds((current) => {
            if (!current.has(fileId)) {
                return current;
            }
            const next = new Set(current);
            next.delete(fileId);
            return next;
        });
    }, [parsed.files, setCollapsedIds]);

    const getCurrentFileIndex = useCallback(() => {
        if (parsed.files.length === 0) {
            return 0;
        }

        const viewer = viewerRef.current?.getInstance();
        if (viewer == null) {
            return Math.min(activeFileIndexRef.current, parsed.files.length - 1);
        }

        const viewportTop = viewerScrollTopRef.current + 8;
        let currentIndex = 0;
        for (let index = 0; index < parsed.files.length; index++) {
            const target = parsed.getScrollTarget(parsed.files[index].id);
            if (target == null) {
                continue;
            }
            const itemTop = viewer.getTopForItem(target.id);
            if (itemTop == null) {
                continue;
            }
            if (itemTop > viewportTop) {
                break;
            }
            currentIndex = index;
        }
        activeFileIndexRef.current = currentIndex;
        return currentIndex;
    }, [parsed]);

    const navigateFile = useCallback((direction: -1 | 1) => {
        if (parsed.files.length === 0) {
            return;
        }
        const currentIndex = getCurrentFileIndex();
        const nextIndex = modulo(currentIndex + direction, parsed.files.length);
        scrollToFile(parsed.files[nextIndex].id);
    }, [getCurrentFileIndex, parsed.files, scrollToFile]);

    useEffect(() => {
        treeModel.resetPaths(parsed.paths);
        treeModel.setGitStatus(parsed.gitStatus);
    }, [parsed.paths, parsed.gitStatus, treeModel]);

    useEffect(() => {
        onTreeSelectionRef.current = (paths) => {
            const selectedPath = paths[0];
            if (selectedPath == null) {
                return;
            }
            const fileId = parsed.getFileIdByPath(selectedPath);
            if (fileId == null) {
                return;
            }
            scrollToFile(fileId);
        };
    }, [parsed, scrollToFile]);

    useEffect(() => {
        const fileId = pendingTreeScrollFileIdRef.current;
        if (fileId == null) {
            return;
        }

        const file = parsed.getFileById(fileId);
        if (file?.collapsed === true) {
            return;
        }
        const scrollTarget = parsed.getScrollTarget(fileId);
        if (scrollTarget == null) {
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            viewerRef.current?.scrollTo({
                ...scrollTarget,
                align: 'start',
                behavior: 'smooth-auto',
            });
            pendingTreeScrollFileIdRef.current = null;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [parsed, scrollTrigger]);

    const keyboardActions = {
        closeDraftReview: () => setDraftReview(null),
        closeShortcutHelp: () => setShowShortcuts(false),
        closeTreeSearch: () => treeSearch.close(),
        copyReviews: () => void copyReviews(),
        focusNextFile: () => navigateFile(1),
        focusPreviousFile: () => navigateFile(-1),
        openTreeSearch: () => treeSearch.open(),
        toggleAllCollapsed,
        toggleBackgrounds: () => setShowBackgrounds((value) => !value),
        toggleDiffStyle: () => setDiffStyle((value) => value === 'unified' ? 'split' : 'unified'),
        toggleLineNumbers: () => setLineNumbers((value) => !value),
        toggleOverflow: () => setOverflow((value) => value === 'wrap' ? 'scroll' : 'wrap'),
        toggleShortcutHelp: () => setShowShortcuts((value) => !value),
    };

    const keyboardState = {
        draftReviewOpen: draftReview != null,
        shortcutHelpOpen: showShortcuts,
        treeSearchOpen: treeSearch.isOpen,
    };

    return {
        activeCommitId,
        allCollapsed,
        copyReviews,
        copyStatus,
        diffStyle,
        draftReview,
        error,
        keyboardActions,
        keyboardState,
        largeDiffLabel,
        lineNumbers,
        loadingDetails,
        loadingMessage,
        loadState,
        nextReviewIdRef,
        overflow,
        parsed,
        response,
        reviewButtonLabel,
        reviews,
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
        shortcutScopeRef,
        showBackgrounds,
        showShortcuts,
        toggleAllCollapsed,
        treeModel,
        viewerRef,
        viewerScrollTopRef,
    };
}

export type DiffViewerModel = ReturnType<typeof useDiffViewerModel>;
