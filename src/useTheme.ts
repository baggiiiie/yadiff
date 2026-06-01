import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'yadiff:theme-mode';

function getSystemTheme(): ResolvedTheme {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadPersistedMode(): ThemeMode {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'auto') {
            return stored;
        }
    } catch {
        // localStorage unavailable
    }
    return 'auto';
}

export function useTheme() {
    const [mode, setModeRaw] = useState<ThemeMode>(loadPersistedMode);
    const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const resolved: ResolvedTheme = mode === 'auto' ? systemTheme : mode;

    useEffect(() => {
        document.documentElement.dataset.theme = resolved;
    }, [resolved]);

    const cycleTheme = useCallback(() => {
        setModeRaw(prev => {
            const next: ThemeMode = prev === 'auto' ? 'light' : prev === 'light' ? 'dark' : 'auto';
            try { localStorage.setItem(STORAGE_KEY, next); } catch {}
            return next;
        });
    }, []);

    const setMode = useCallback((next: ThemeMode) => {
        setModeRaw(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // localStorage unavailable
        }
    }, []);

    return useMemo(() => ({
        mode,
        resolved,
        setMode,
        cycleTheme,
    }), [mode, resolved, setMode, cycleTheme]);
}

export type ThemeState = ReturnType<typeof useTheme>;

const ThemeContext = createContext<ThemeState | null>(null);
export const ThemeProvider = ThemeContext.Provider;

export function useThemeContext(): ThemeState {
    const ctx = use(ThemeContext);
    if (ctx == null) {
        throw new Error('useThemeContext must be used within a ThemeProvider');
    }
    return ctx;
}
