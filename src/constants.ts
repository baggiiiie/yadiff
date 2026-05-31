export const REVIEW_UNSAFE_CSS = `
  [data-line-annotation],
  [data-gutter-buffer='annotation'] {
    --diffs-annotation-bg: var(--diffs-bg) !important;
    --diffs-computed-decoration-bg: var(--diffs-bg) !important;
    --diffs-computed-diff-line-bg: var(--diffs-bg) !important;
    --diffs-computed-selected-line-bg: var(--diffs-bg) !important;
    --diffs-line-bg: var(--diffs-bg) !important;
  }
`;

export const DIFF_WORKER_POOL_OPTIONS = {
    workerFactory: () => new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
};

export const DIFF_HIGHLIGHTER_OPTIONS = {
    theme: { dark: 'pierre-dark', light: 'pierre-light' } as const,
};

export const SHORTCUTS: [string, string][] = [
    ['T', 'Tree search'],
    ['U', 'Unified diff'],
    ['W', 'Line wrap'],
    ['L', 'Line numbers'],
    ['B', 'Backgrounds'],
    ['D', 'Cycle theme (auto/light/dark)'],
    ['C', 'Collapse or expand all'],
    ['J / K', 'Next or previous file'],
    ['Y', 'Copy reviews'],
    ['Esc', 'Dismiss search or draft review'],
];
