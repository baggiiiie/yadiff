import type { FileStats } from '../types';

export function TreeHeader({ stats }: { stats: FileStats }) {
    return (
        <div className="treeHeader">
            <span>{stats.files} files changed</span>
            <span className="plus">+{stats.additions}</span>
            <span className="minus">−{stats.deletions}</span>
            <span className="treeShortcuts">T search · J/K files</span>
        </div>
    );
}
