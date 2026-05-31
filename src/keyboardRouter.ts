import { type RefObject, useEffect, useEffectEvent } from 'react';

import { hasEditableShortcutTarget } from './utils';

interface KeyboardRouterState {
    draftReviewOpen: boolean;
    shortcutHelpOpen: boolean;
    treeSearchOpen: boolean;
}

export interface KeyboardRouterActions {
    closeDraftReview: () => void;
    closeShortcutHelp: () => void;
    closeTreeSearch: () => void;
    copyReviews: () => void;
    cycleTheme: () => void;
    focusNextFile: () => void;
    focusPreviousFile: () => void;
    openTreeSearch: () => void;
    toggleAllCollapsed: () => void;
    toggleBackgrounds: () => void;
    toggleDiffStyle: () => void;
    toggleLineNumbers: () => void;
    toggleOverflow: () => void;
    toggleShortcutHelp: () => void;
}

interface KeyboardRouterOptions {
    actions: KeyboardRouterActions;
    shortcutScopeRef: RefObject<HTMLElement | null>;
    state: KeyboardRouterState;
}

function isFileTreeSearchInputTarget(target: EventTarget): target is HTMLElement {
    return target instanceof HTMLElement && target.hasAttribute('data-file-tree-search-input');
}

function getFileTreeSearchInputTarget(event: Event): HTMLElement | null {
    return event.composedPath().find(isFileTreeSearchInputTarget) ?? null;
}

function hasCommandModifier(event: KeyboardEvent): boolean {
    return event.metaKey || event.ctrlKey || event.altKey;
}

function focusShortcutScope(shortcutScope: HTMLElement | null, fallbackBlurTarget: HTMLElement): void {
    if (shortcutScope == null) {
        fallbackBlurTarget.blur();
        return;
    }
    shortcutScope.focus({ preventScroll: true });
}

function consume(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
}

function routeTreeSearchEscape(event: KeyboardEvent, options: KeyboardRouterOptions): void {
    if (event.defaultPrevented || event.key !== 'Escape' || hasCommandModifier(event)) {
        return;
    }

    const searchInput = getFileTreeSearchInputTarget(event);
    if (searchInput == null) {
        return;
    }

    options.actions.closeTreeSearch();
    focusShortcutScope(options.shortcutScopeRef.current, searchInput);
    consume(event);
}

function routeAppShortcut(event: KeyboardEvent, options: KeyboardRouterOptions): void {
    if (event.defaultPrevented || hasCommandModifier(event)) {
        return;
    }

    const key = event.key.toLowerCase();
    if (key !== 'escape' && hasEditableShortcutTarget(event)) {
        return;
    }

    const { actions, state } = options;
    let handled = true;
    switch (key) {
        case 't':
            actions.openTreeSearch();
            break;
        case 'u':
            actions.toggleDiffStyle();
            break;
        case 'w':
            actions.toggleOverflow();
            break;
        case 'l':
            actions.toggleLineNumbers();
            break;
        case 'b':
            actions.toggleBackgrounds();
            break;
        case 'd':
            actions.cycleTheme();
            break;
        case 'c':
            actions.toggleAllCollapsed();
            break;
        case 'j':
            actions.focusNextFile();
            break;
        case 'k':
            actions.focusPreviousFile();
            break;
        case 'y':
            actions.copyReviews();
            break;
        case '?':
            actions.toggleShortcutHelp();
            break;
        case 'escape':
            if (state.shortcutHelpOpen) {
                actions.closeShortcutHelp();
            } else if (state.draftReviewOpen) {
                actions.closeDraftReview();
            } else if (state.treeSearchOpen) {
                actions.closeTreeSearch();
            } else {
                handled = false;
            }
            break;
        default:
            handled = false;
    }

    if (handled) {
        event.preventDefault();
    }
}

export function useKeyboardRouter(options: KeyboardRouterOptions): void {
    const handleKeyDownCapture = useEffectEvent((event: KeyboardEvent) => {
        routeTreeSearchEscape(event, options);
    });
    const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
        routeAppShortcut(event, options);
    });

    useEffect(() => {
        const onKeyDownCapture = (event: KeyboardEvent) => handleKeyDownCapture(event);
        const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event);
        window.addEventListener('keydown', onKeyDownCapture, true);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDownCapture, true);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, []);
}
