import { formatSource } from '../format';
import type { DiffViewerModel } from '../useDiffViewerModel';
import { useThemeContext } from '../useTheme';
import { PillButton } from './PillButton';
import { ShortcutHelp } from './ShortcutHelp';

interface ToolbarProps {
    allCollapsed: DiffViewerModel['allCollapsed'];
    copyReviews: DiffViewerModel['copyReviews'];
    copyStatus: DiffViewerModel['copyStatus'];
    diffStyle: DiffViewerModel['diffStyle'];
    largeDiffLabel: DiffViewerModel['largeDiffLabel'];
    lineNumbers: DiffViewerModel['lineNumbers'];
    overflow: DiffViewerModel['overflow'];
    response: DiffViewerModel['response'];
    reviewButtonLabel: DiffViewerModel['reviewButtonLabel'];
    setDiffStyle: DiffViewerModel['setDiffStyle'];
    setLineNumbers: DiffViewerModel['setLineNumbers'];
    setOverflow: DiffViewerModel['setOverflow'];
    setShowBackgrounds: DiffViewerModel['setShowBackgrounds'];
    setShowShortcuts: DiffViewerModel['setShowShortcuts'];
    showBackgrounds: DiffViewerModel['showBackgrounds'];
    showShortcuts: DiffViewerModel['showShortcuts'];
    toggleAllCollapsed: DiffViewerModel['toggleAllCollapsed'];
    toggleTreeViewHidden: DiffViewerModel['toggleTreeViewHidden'];
    treeViewHidden: DiffViewerModel['treeViewHidden'];
}

export function Toolbar({
    allCollapsed,
    copyReviews,
    copyStatus,
    diffStyle,
    largeDiffLabel,
    lineNumbers,
    overflow,
    response,
    reviewButtonLabel,
    setDiffStyle,
    setLineNumbers,
    setOverflow,
    setShowBackgrounds,
    setShowShortcuts,
    showBackgrounds,
    showShortcuts,
    toggleAllCollapsed,
    toggleTreeViewHidden,
    treeViewHidden,
}: ToolbarProps) {
    const theme = useThemeContext();
    const themeLabel = theme.mode === 'auto' ? 'Auto' : theme.mode === 'light' ? 'Light' : 'Dark';
    return (
        <header className="toolbar">
            <div className="titleBlock">
                <div className="eyebrow">yadiff · {formatSource(response?.source)}</div>
                <h1>{response?.repositoryName} <span>{response?.target}</span></h1>
                {largeDiffLabel != null ? <div className="largeDiffBadge">{largeDiffLabel}</div> : null}
            </div>
            <a
                className="poweredBy"
                href="https://github.com/pierrecomputer/pierre/tree/main/packages"
                target="_blank"
                rel="noreferrer"
                title="Powered by @pierre/diffs and @pierre/trees"
            >
                Powered by Diffs and Trees
            </a>
            <div className="controls">
                <div className="shortcutHelp">
                    <button
                        type="button"
                        className="shortcutHelpButton"
                        aria-expanded={showShortcuts}
                        onClick={() => setShowShortcuts((value) => !value)}
                        title="Show keyboard shortcuts (?)"
                    >
                        Shortcuts (?)
                    </button>
                    {showShortcuts ? <ShortcutHelp /> : null}
                </div>
                <PillButton active={diffStyle === 'unified'} onClick={() => setDiffStyle(diffStyle === 'unified' ? 'split' : 'unified')} title="Toggle unified diff (U)">
                    Unified (U)
                </PillButton>
                <PillButton active={overflow === 'wrap'} onClick={() => setOverflow(overflow === 'wrap' ? 'scroll' : 'wrap')} title="Toggle line wrap (W)">
                    Wrap (W)
                </PillButton>
                <PillButton active={lineNumbers} onClick={() => setLineNumbers((value) => !value)} title="Toggle line numbers (L)">
                    Lines (L)
                </PillButton>
                <PillButton active={showBackgrounds} onClick={() => setShowBackgrounds((value) => !value)} title="Toggle background highlights (B)">
                    Background (B)
                </PillButton>
                <PillButton active={!treeViewHidden} onClick={toggleTreeViewHidden} title={treeViewHidden ? 'Show tree view (S)' : 'Hide tree view (S)'}>
                    Tree (S)
                </PillButton>
                <PillButton active={theme.mode !== 'auto'} onClick={theme.cycleTheme} title="Cycle theme: auto / light / dark (D)">
                    {themeLabel} (D)
                </PillButton>
                <PillButton active={allCollapsed} onClick={toggleAllCollapsed} title={allCollapsed ? 'Expand all files (C)' : 'Collapse all files (C)'}>
                    {allCollapsed ? 'Expand (C)' : 'Collapse (C)'}
                </PillButton>
                <button type="button" className={copyStatus === 'idle' ? 'button' : `button status-${copyStatus}`} onClick={copyReviews} title="Copy reviews (Y)">
                    {reviewButtonLabel}
                </button>
                <a className="button" href="/api/raw.diff" target="_blank" rel="noreferrer">Raw</a>
            </div>
        </header>
    );
}
