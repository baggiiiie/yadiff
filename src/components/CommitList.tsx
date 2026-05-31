import type { CommitInfo } from '../types';

export function CommitList({
    commits,
    activeCommitId,
    onSelect,
}: {
    commits: CommitInfo[];
    activeCommitId: string | null;
    onSelect: (id: string | null) => void;
}) {
    return (
        <div className="commitList">
            <div className="commitListHeader">Commits</div>
            <button
                type="button"
                className={activeCommitId == null ? 'commitItem active' : 'commitItem'}
                onClick={() => onSelect(null)}
            >
                <span className="commitItemLabel">All changes (combined)</span>
            </button>
            {commits.map((commit) => (
                <button
                    key={commit.id}
                    type="button"
                    className={activeCommitId === commit.id ? 'commitItem active' : 'commitItem'}
                    onClick={() => onSelect(commit.id)}
                    title={commit.id}
                >
                    <span className="commitItemShortId">{commit.shortId}</span>
                    <span className="commitItemMessage">{commit.message}</span>
                </button>
            ))}
        </div>
    );
}
