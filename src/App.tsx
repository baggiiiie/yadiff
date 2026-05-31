import { ReadyDiffView } from './components/ReadyDiffView';
import { Shell } from './components/Shell';
import { useDiffViewerModel } from './useDiffViewerModel';
import { ThemeProvider, useTheme } from './useTheme';

export function App() {
    const theme = useTheme();
    const model = useDiffViewerModel();

    let content;
    if (model.loadState === 'loading') {
        content = <Shell message={model.loadingMessage} details={model.loadingDetails ?? undefined} />;
    } else if (model.loadState === 'error') {
        content = <Shell message="Could not render this diff" details={model.error ?? undefined} />;
    } else {
        content = <ReadyDiffView model={model} />;
    }

    return <ThemeProvider value={theme}>{content}</ThemeProvider>;
}
