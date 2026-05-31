import { SHORTCUTS } from '../constants';

export function ShortcutHelp() {
    return (
        <section className="shortcutPopover" aria-label="Keyboard shortcuts">
            {SHORTCUTS.map(([key, label]) => (
                <div className="shortcutRow" key={key}>
                    <kbd>{key}</kbd>
                    <span>{label}</span>
                </div>
            ))}
        </section>
    );
}
