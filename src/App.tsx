import { ReadyDiffView } from './components/ReadyDiffView';
import { Shell } from './components/Shell';
import { useDiffViewerModel } from './useDiffViewerModel';

export function App() {
    const model = useDiffViewerModel();

    if (model.loadState === 'loading') {
        return <Shell message={model.loadingMessage} details={model.loadingDetails ?? undefined} />;
    }

    if (model.loadState === 'error') {
        return <Shell message="Could not render this diff" details={model.error ?? undefined} />;
    }

    return <ReadyDiffView model={model} />;
}
