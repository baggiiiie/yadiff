import { FileTree } from '@pierre/trees/react';

import type { DiffViewerModel } from '../useDiffViewerModel';
import { CommitList } from './CommitList';
import { TreeHeader } from './TreeHeader';

interface SidebarProps {
    activeCommitId: DiffViewerModel['activeCommitId'];
    parsed: DiffViewerModel['parsed'];
    response: DiffViewerModel['response'];
    selectCommit: DiffViewerModel['selectCommit'];
    toggleTreeViewHidden: DiffViewerModel['toggleTreeViewHidden'];
    treeModel: DiffViewerModel['treeModel'];
    treeViewHidden: DiffViewerModel['treeViewHidden'];
}

export function Sidebar({
    activeCommitId,
    parsed,
    response,
    selectCommit,
    toggleTreeViewHidden,
    treeModel,
    treeViewHidden,
}: SidebarProps) {
    return (
        <aside className={treeViewHidden ? 'sidebar sidebarHidden' : 'sidebar'}>
            <button
                type="button"
                className="sidebarToggle"
                aria-controls="file-tree-sidebar-content"
                aria-expanded={!treeViewHidden}
                onClick={toggleTreeViewHidden}
                title={treeViewHidden ? 'Show tree view (S)' : 'Hide tree view (S)'}
            >
                <span aria-hidden="true">{treeViewHidden ? 'Files ›' : '‹'}</span>
                <span className="srOnly">{treeViewHidden ? 'Show tree view' : 'Hide tree view'}</span>
            </button>
            {!treeViewHidden ? (
                <div id="file-tree-sidebar-content" className="sidebarContent">
                    {response?.commits != null && response.commits.length > 0 && (
                        <CommitList
                            commits={response.commits}
                            activeCommitId={activeCommitId}
                            onSelect={selectCommit}
                        />
                    )}
                    <FileTree
                        model={treeModel}
                        header={<TreeHeader stats={parsed.stats} />}
                        className="fileTree"
                        style={{ height: '100%' }}
                    />
                </div>
            ) : null}
        </aside>
    );
}
