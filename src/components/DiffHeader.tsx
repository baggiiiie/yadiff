import type { ProjectedFile } from '../diffProjection';

export function DiffHeader({ file, onToggle }: { file: ProjectedFile; onToggle: () => void }) {
    return (
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
            <FileMeta file={file} />
        </div>
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
