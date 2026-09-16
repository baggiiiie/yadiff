import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';

interface DismissablePopoverOptions {
    onClose: () => void;
    open: boolean;
    /**
     * Trigger element. Needed when the popover is portaled out of the trigger's subtree, so
     * pressing the trigger is not mistaken for an outside press.
     */
    anchorRef?: RefObject<HTMLElement | null>;
    /**
     * Close on any scroll. Required for fixed-position popovers, whose anchor can move while
     * the page or an inner scroller scrolls.
     */
    closeOnScroll?: boolean;
}

/**
 * Dismisses a popover when the user presses outside it, hits Escape, or (optionally) scrolls.
 * The returned ref marks the popover container: it defines "inside" for the pointer check.
 *
 * Escape is safe to handle here: the app keyboard router treats it as a no-op whenever none
 * of its own layers (shortcut help, tree search, draft review) is open.
 */
export function useDismissablePopover({
    anchorRef,
    closeOnScroll = false,
    onClose,
    open,
}: DismissablePopoverOptions): RefObject<HTMLDivElement | null> {
    const containerRef = useRef<HTMLDivElement>(null);
    const close = useEffectEvent(onClose);

    useEffect(() => {
        if (!open) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (containerRef.current?.contains(target) === true) {
                return;
            }
            if (anchorRef?.current?.contains(target) === true) {
                return;
            }
            close();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
            }
        };
        const onScroll = () => close();

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        if (closeOnScroll) {
            // Capture: scroll events from inner scrollers do not bubble.
            document.addEventListener('scroll', onScroll, true);
        }
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [anchorRef, closeOnScroll, open]);

    return containerRef;
}
