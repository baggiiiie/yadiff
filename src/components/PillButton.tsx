import type { ReactNode } from 'react';

export function PillButton({
    active,
    children,
    onClick,
    title,
}: {
    active?: boolean;
    children: ReactNode;
    onClick: () => void;
    title?: string;
}) {
    return (
        <button
            type="button"
            className={active ? 'button active' : 'button'}
            aria-pressed={active}
            onClick={onClick}
            title={title}
        >
            {children}
        </button>
    );
}
