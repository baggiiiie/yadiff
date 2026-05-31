export function increment(value: number): number {
    return value + 1;
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function modulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function hasEditableShortcutTarget(event: Event): boolean {
    return isEditableShortcutTarget(event.target) || event.composedPath().some(isEditableShortcutTarget);
}
