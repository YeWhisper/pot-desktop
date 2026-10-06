import { invoke } from '@tauri-apps/api';
import { Body, fetch } from '@tauri-apps/api/http';
import { info, warn } from 'tauri-plugin-log-api';

import { createLmStudioHeaders } from '../services/translate/lmstudio/api';
import { store } from './store';
import { ensureFirstLmStudioModel } from './lmstudio_warmup_core';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadLmStudioEntries() {
    await store.load();
    const serviceList = (await store.get('translate_service_list')) ?? [];
    const entries = [];

    for (const instanceKey of serviceList) {
        if (instanceKey.split('@')[0] !== 'lmstudio') continue;
        entries.push({ instanceKey, config: await store.get(instanceKey) });
    }
    return entries;
}

async function getModels(entry, target) {
    try {
        const response = await fetch(target.modelsUrl, {
            method: 'GET',
            headers: createLmStudioHeaders(entry.config.apiKey),
            timeout: 2,
        });
        if (!response.ok || !Array.isArray(response.data?.models)) return null;
        return response.data;
    } catch {
        return null;
    }
}

async function loadModel(entry, target) {
    const response = await fetch(target.loadUrl, {
        method: 'POST',
        headers: createLmStudioHeaders(entry.config.apiKey),
        body: Body.json({ model: entry.config.model }),
        timeout: 120,
    });
    if (!response.ok) throw new Error(`LM Studio model load failed with HTTP ${response.status}`);
}

let inflightWarmup = null;

export async function waitForLmStudioWarmup() {
    await inflightWarmup;
}

export function warmupLMStudio() {
    if (!inflightWarmup) {
        inflightWarmup = (async () => {
            const entries = await loadLmStudioEntries();
            const result = await ensureFirstLmStudioModel(entries, {
                getModels,
                startServer: (port) => invoke('start_lmstudio_server', { port }),
                loadModel,
                sleep,
            });

            if (result.status === 'loaded') {
                info(`LM Studio startup loaded model: ${result.entry.config.model}`);
            } else if (result.status === 'already-loaded') {
                info(`LM Studio startup model already loaded: ${result.entry.config.model}`);
            } else if (result.status === 'unreachable') {
                warn(`LM Studio did not become reachable: ${result.entry.config.baseUrl}`);
            }
        })()
            .catch((error) => warn(`LM Studio startup warmup failed: ${error}`))
            .finally(() => {
                inflightWarmup = null;
            });
    }
    return inflightWarmup;
}
