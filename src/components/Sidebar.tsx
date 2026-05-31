import { FileTree } from '@pierre/trees/react';

import type { DiffViewerModel } from '../useDiffViewerModel';
import { CommitList } from './CommitList';
import { TreeHeader } from './TreeHeader';

interface SidebarProps {
    activeCommitId: DiffViewerModel['activeCommitId'];
    parsed: DiffViewerModel['parsed'];
    response: DiffViewerModel['response'];
    selectCommit: DiffViewerModel['selectCommit'];
    treeModel: DiffViewerModel['treeModel'];
}

export function Sidebar({ activeCommitId, parsed, response, selectCommit, treeModel }: SidebarProps) {
    return (
        <aside className="sidebar">
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
        </aside>
    );
}
