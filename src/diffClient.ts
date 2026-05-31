import { byteLength } from './format';
import { delay } from './utils';
import type { DiffResponse, DiffStatusResponse } from './types';

export async function fetchDiffMetadata(onStatus: (status: DiffStatusResponse) => void): Promise<DiffResponse> {
    const result = await fetch('/api/diff', { cache: 'no-store' });
    const data = (await result.json()) as DiffResponse | DiffStatusResponse;
    if (result.status === 202 || data.status === 'fetching') {
        onStatus(data as DiffStatusResponse);
        await pollUntilReady(onStatus);
        return fetchDiffMetadata(onStatus);
    }
    if (!result.ok || data.status === 'error') {
        throw new Error(data.error ?? `Request failed (${result.status})`);
    }
    return data as DiffResponse;
}

export async function fetchCommitPatchText(commitId: string): Promise<string> {
    const result = await fetch(`/api/diff/${encodeURIComponent(commitId)}`, { cache: 'no-store' });
    const data = await result.json();
    if (!result.ok) {
        throw new Error(data.error ?? `Request failed (${result.status})`);
    }
    return data.patch;
}

async function pollUntilReady(onStatus: (status: DiffStatusResponse) => void): Promise<void> {
    while (true) {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- Polling must wait between status checks and stop once the server reports ready.
        await delay(500);
        const result = await fetch('/api/diff/status', { cache: 'no-store' });
        const data = (await result.json()) as DiffStatusResponse;
        if (!result.ok || data.status === 'error') {
            throw new Error(data.error ?? `Request failed (${result.status})`);
        }
        onStatus(data);
        if (data.status === 'ready') {
            return;
        }
    }
}

export async function fetchPatchText(url: string, onProgress: (downloaded: number, total?: number) => void): Promise<string> {
    const result = await fetch(url, { cache: 'no-store' });
    if (!result.ok) {
        const details = await result.text();
        throw new Error(details || `Could not load raw diff (${result.status})`);
    }

    const totalHeader = result.headers.get('content-length');
    const total = totalHeader == null ? undefined : Number(totalHeader);
    if (result.body == null) {
        const text = await result.text();
        onProgress(byteLength(text), Number.isFinite(total) ? total : undefined);
        return text;
    }

    const reader = result.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let downloaded = 0;
    while (true) {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- ReadableStream chunks must be consumed sequentially from a single reader.
        const { done, value } = await reader.read();
        if (done) break;
        if (value == null) continue;
        downloaded += value.byteLength;
        onProgress(downloaded, Number.isFinite(total) ? total : undefined);
        chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
}
