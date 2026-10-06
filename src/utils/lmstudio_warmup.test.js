import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate as settle } from 'node:timers/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as lmStudioApi from '../services/translate/lmstudio/api.js';

import {
    ensureFirstLmStudioModel,
    getManagementTarget,
    isModelLoaded,
    selectFirstLmStudioEntry,
} from './lmstudio_warmup_core.js';

const entries = [
    { instanceKey: 'openai@cloud', config: { model: 'cloud' } },
    {
        instanceKey: 'lmstudio@first',
        config: { baseUrl: 'http://localhost:1234/v1', model: 'hy-mt2-1.8b', apiKey: '' },
    },
    {
        instanceKey: 'lmstudio@second',
        config: { baseUrl: 'http://localhost:1234/v1', model: 'second', apiKey: '' },
    },
];

test('selects only the first configured LM Studio entry', () => {
    assert.equal(selectFirstLmStudioEntry(entries).instanceKey, 'lmstudio@first');
});

test('derives native management URLs and local port from the OpenAI base URL', () => {
    assert.deepEqual(getManagementTarget('http://localhost:1234/v1'), {
        isLocal: true,
        port: 1234,
        modelsUrl: 'http://localhost:1234/api/v1/models',
        loadUrl: 'http://localhost:1234/api/v1/models/load',
    });
    assert.equal(getManagementTarget('https://models.example.com/v1').isLocal, false);
});

test('recognizes a model key or instance identifier as loaded', () => {
    const response = {
        models: [{ key: 'hy-mt2-1.8b', loaded_instances: [{ id: 'translator' }] }],
    };
    assert.equal(isModelLoaded(response, 'hy-mt2-1.8b'), true);
    assert.equal(isModelLoaded(response, 'translator'), true);
    assert.equal(isModelLoaded(response, 'other'), false);
});

test('starts a local server after a failed probe and loads the configured model', async () => {
    let probes = 0;
    let starts = 0;
    let loads = 0;
    const result = await ensureFirstLmStudioModel(
        entries,
        {
            getModels: async () =>
                ++probes === 1 ? null : { models: [{ key: 'hy-mt2-1.8b', loaded_instances: [] }] },
            startServer: async (port) => {
                assert.equal(port, 1234);
                starts++;
            },
            loadModel: async (entry) => {
                assert.equal(entry.config.model, 'hy-mt2-1.8b');
                loads++;
            },
            sleep: async () => {},
        },
        { maxAttempts: 2, intervalMs: 0 }
    );

    assert.equal(result.status, 'loaded');
    assert.equal(starts, 1);
    assert.equal(loads, 1);
});

test('retries a transient model load failure', async () => {
    let loads = 0;
    let sleeps = 0;
    const result = await ensureFirstLmStudioModel(
        entries,
        {
            getModels: async () => ({ models: [{ key: 'hy-mt2-1.8b', loaded_instances: [] }] }),
            startServer: async () => assert.fail('server is already reachable'),
            loadModel: async () => {
                loads++;
                if (loads === 1) throw new Error('connection closed before message completed');
            },
            sleep: async () => sleeps++,
        },
        { loadAttempts: 2, intervalMs: 0 }
    );

    assert.equal(result.status, 'loaded');
    assert.equal(loads, 2);
    assert.equal(sleeps, 1);
});

test('does not start a local process for a remote server', async () => {
    const remote = [
        { instanceKey: 'lmstudio@remote', config: { baseUrl: 'https://models.example.com/v1', model: 'm' } },
    ];
    let starts = 0;
    const result = await ensureFirstLmStudioModel(
        remote,
        {
            getModels: async () => null,
            startServer: async () => starts++,
            loadModel: async () => assert.fail('must not load an unreachable model'),
            sleep: async () => {},
        },
        { maxAttempts: 2, intervalMs: 0 }
    );

    assert.equal(result.status, 'unreachable');
    assert.equal(starts, 0);
});

test('skips loading when the model is already in memory', async () => {
    let loads = 0;
    const result = await ensureFirstLmStudioModel(entries, {
        getModels: async () => ({
            models: [{ key: 'hy-mt2-1.8b', loaded_instances: [{ id: 'hy-mt2-1.8b' }] }],
        }),
        startServer: async () => assert.fail('server is already reachable'),
        loadModel: async () => loads++,
        sleep: async () => {},
    });

    assert.equal(result.status, 'already-loaded');
    assert.equal(loads, 0);
});

// Execute the real warmup and provider modules; stub only desktop APIs and the chat transport.
function loadModule(path, dependencies) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    vm.runInNewContext(outputText, {
        exports,
        setTimeout,
        require(name) {
            assert.ok(name in dependencies, `Unexpected import: ${name}`);
            return dependencies[name];
        },
    });
    return exports;
}

function startupTranslation() {
    let finishLoad;
    const loading = new Promise((resolve) => {
        finishLoad = resolve;
    });
    const calls = { probes: 0, loads: 0, chats: 0, duplicateLoads: 0 };
    let loaded = false;
    const warmup = loadModule('./lmstudio_warmup.js', {
        '@tauri-apps/api': { invoke: async () => assert.fail('server is already reachable') },
        '@tauri-apps/api/http': {
            Body: { json: (value) => value },
            fetch: async (_, options) => {
                if (options.method === 'GET') {
                    calls.probes++;
                    return { ok: true, data: { models: [{ key: 'hy-mt2-1.8b', loaded_instances: [] }] } };
                }
                calls.loads++;
                await loading;
                loaded = true;
                return { ok: true };
            },
        },
        'tauri-plugin-log-api': { info() {}, warn() {} },
        '../services/translate/lmstudio/api': lmStudioApi,
        './store': {
            store: {
                load: async () => {},
                get: async (key) => (key === 'translate_service_list' ? ['lmstudio@first'] : entries[1].config),
            },
        },
        './lmstudio_warmup_core': { ensureFirstLmStudioModel },
    });
    const provider = loadModule('../services/translate/lmstudio/index.jsx', {
        '../openai': {
            translate: async () => {
                calls.chats++;
                if (!loaded) calls.duplicateLoads++;
                return 'translated';
            },
        },
        './api': lmStudioApi,
        '../../../utils/lmstudio_warmup': warmup,
        './Config': {},
        './info': {},
    });
    return {
        warmup: warmup.warmupLMStudio,
        translate: (signal) => provider.translate('nginx', 'en', 'zh_cn', { config: entries[1].config, signal }),
        finishLoad,
        calls,
    };
}

test('startup warmup and simultaneous translations never overlap model loading with chat requests', async () => {
    const app = startupTranslation();
    const warmup = app.warmup();
    const translations = [app.translate(), app.translate()];
    await settle();
    const chatsWhileLoading = app.calls.chats;
    app.finishLoad();
    await warmup;
    assert.deepEqual(await Promise.all(translations), ['translated', 'translated']);
    assert.equal(chatsWhileLoading, 0, 'chat must wait for explicit loading to finish');
    assert.deepEqual(app.calls, { probes: 1, loads: 1, chats: 2, duplicateLoads: 0 });
    await app.translate();
    assert.equal(app.calls.probes, 1, 'later translations must not restart warmup');
    assert.equal(app.calls.loads, 1);
});

test('a translation cancelled during LM Studio warmup never sends a chat request', async () => {
    const app = startupTranslation();
    const controller = new AbortController();
    const warmup = app.warmup();
    const translation = app.translate(controller.signal);
    const rejected = assert.rejects(translation, { name: 'AbortError' });
    controller.abort();
    app.finishLoad();
    await warmup;
    await rejected;
    assert.equal(app.calls.chats, 0);
});

test('translation without startup warmup proceeds without an explicit model load', async () => {
    const app = startupTranslation();
    assert.equal(await app.translate(), 'translated');
    assert.equal(app.calls.probes, 0);
    assert.equal(app.calls.loads, 0);
    assert.equal(app.calls.chats, 1);
});
