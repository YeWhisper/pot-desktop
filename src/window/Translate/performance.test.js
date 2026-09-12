import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createTranslationRequest } from './translation_request.js';

function parse(path) {
    return ts.createSourceFile(
        path,
        readFileSync(new URL(path, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JSX
    );
}

test('stream bursts are coalesced and final output cannot be overwritten by queued text', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const values = [];
    const request = createTranslationRequest((value) => values.push(value));
    for (let i = 0; i < 100; i++) request.update(String(i));
    assert.deepEqual(values, []);
    t.mock.timers.tick(32);
    assert.deepEqual(values, ['99']);
    request.update('partial_');
    request.finish('complete');
    request.update('late callback');
    t.mock.timers.tick(100);
    assert.deepEqual(values, ['99', 'complete']);
});

test('cancellation aborts the transport signal and discards pending and late callbacks', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const values = [];
    const request = createTranslationRequest((value) => values.push(value));
    request.update('old');
    request.cancel();
    request.update('late');
    request.finish('late final');
    t.mock.timers.tick(100);
    assert.equal(request.signal.aborted, true);
    assert.deepEqual(values, []);
});

// Run the actual component logic and effect dependencies, without a WebView or build.
function targetArea() {
    const file = parse('./components/TargetArea/index.jsx');
    const component = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === 'TargetArea');
    const body = component.body.statements
        .filter((node) => !ts.isReturnStatement(node))
        .map((node) => node.getText(file));
    const config = { history_disable: true };
    const atoms = { sourceText: 'hello', sourceLanguage: 'en', targetLanguage: 'zh', detectLanguage: 'en' };
    const requests = [];
    const copies = [];
    const hooks = [];
    let cursor = 0;
    let effects = [];
    let previous;
    const context = vm.createContext({
        props: { index: 0, name: 'openai', serviceInstanceConfigMap: { openai: {} } },
        useState(initial) {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = initial;
            return [hooks[index], (value) => (hooks[index] = value)];
        },
        useRef(initial) {
            const index = cursor++;
            return (hooks[index] ??= { current: initial });
        },
        useConfig: (key, fallback) => [key in config ? config[key] : fallback],
        useEffect: (run, deps) => effects.push({ run, deps }),
        useAtomValue: (atom) => atoms[atom],
        useSetAtom: () => () => {},
        sourceTextAtom: 'sourceText',
        sourceLanguageAtom: 'sourceLanguage',
        targetLanguageAtom: 'targetLanguage',
        detectLanguageAtom: 'detectLanguage',
        inlineTranslateAtom: 'inlineTranslate',
        useTranslation: () => ({ t: (key) => key }),
        useToastStyle() {},
        useVoice() {},
        useTheme() {},
        useMeasure: () => [null, { height: 0 }],
        useSpring() {},
        getServiceName: (value) => value,
        whetherPluginService: () => false,
        createTranslationRequest,
        builtinServices: {
            openai: {
                Language: { en: 'English', zh: 'Chinese' },
                translate: (text, from, to, options) =>
                    new Promise((resolve, reject) => {
                        requests.push({ text, options, resolve, reject });
                    }),
            },
        },
        writeText: async (text) => copies.push(text),
        sendNotification() {},
        info() {},
        logError() {},
    });
    vm.runInContext(
        `globalThis.render = () => { ${body.join('\n')}\n return { result, isLoading, error, translate }; };`,
        context
    );
    return {
        config,
        atoms,
        requests,
        copies,
        render() {
            cursor = 0;
            effects = [];
            const state = context.render();
            const effect = effects.find((item) => item.run.toString().includes('translate();'));
            if (!previous || effect.deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
                previous?.cleanup?.();
                effect.cleanup = effect.run();
            } else {
                effect.cleanup = previous.cleanup;
            }
            previous = effect;
            return state;
        },
        unmount: () => previous?.cleanup?.(),
    };
}

test('copy/window settings do not request another translation and completion uses latest settings', async () => {
    const area = targetArea();
    area.config.translate_auto_copy = null;
    area.render();
    assert.equal(area.requests.length, 0);
    area.config.translate_auto_copy = 'disable';
    area.render();
    area.config.translate_auto_copy = 'target';
    area.config.translate_hide_window = true;
    area.config.clipboard_monitor = true;
    area.render();
    area.config.clipboard_monitor = false;
    area.render();
    assert.equal(area.requests.length, 1);
    area.requests[0].resolve('translated');
    await Promise.resolve();
    assert.deepEqual(area.copies, ['translated']);
    area.unmount();
});

test('replacement, empty input and unmount discard obsolete translations', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const area = targetArea();
    area.render();
    const old = area.requests[0];
    old.options.setResult('old partial');
    area.atoms.sourceText = 'new';
    area.render();
    assert.equal(old.options.signal.aborted, true);
    area.requests[1].resolve('new final');
    await Promise.resolve();
    old.resolve('old final');
    await Promise.resolve();
    t.mock.timers.tick(100);
    assert.equal(area.render().result, 'new final');
    area.atoms.sourceText = '';
    area.render();
    assert.equal(area.requests[1].options.signal.aborted, true);
    assert.equal(area.render().result, '');
    assert.equal(area.render().isLoading, false);
    area.atoms.sourceText = 'third';
    area.render();
    area.unmount();
    assert.equal(area.requests[2].options.signal.aborted, true);
});

function autoFit({ monitor, resize } = {}) {
    const file = parse('./index.jsx');
    let effect;
    function visit(node) {
        if (
            ts.isCallExpression(node) &&
            node.expression.getText(file) === 'useEffect' &&
            node.arguments[0].getText(file).includes('autoFitHeight !== true')
        )
            effect = node.arguments[0].getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file);
    const frames = new Map();
    const listeners = new Map();
    const calls = { monitor: 0, measure: 0, sizes: [] };
    const textarea = { value: 'hello' };
    const root = { offsetHeight: 240, querySelectorAll: () => [textarea] };
    let nextId = 0;
    let observe;
    const register = async (type, callback) => {
        listeners.set(type, callback);
        return () => listeners.delete(type);
    };
    const context = vm.createContext({
        autoFitHeight: true,
        contentRef: { current: root },
        osType: 'Windows',
        appWindow: {
            label: 'translate',
            onMoved: (callback) => register('move', callback),
            onScaleChanged: (callback) => register('scale', callback),
            setSize: async (size) => {
                calls.sizes.push(size);
                await resize?.();
            },
        },
        currentMonitor: async () => {
            calls.monitor++;
            return monitor ? await monitor() : { scaleFactor: 1, size: { width: 1920, height: 1080 } };
        },
        LogicalSize: class {
            constructor(width, height) {
                this.width = width;
                this.height = height;
            }
        },
        document: {
            createElement: () => ({
                getContext: () => ({
                    measureText: (text) => {
                        calls.measure++;
                        return { width: text.length * 10 };
                    },
                }),
            }),
        },
        getComputedStyle: () => ({ fontSize: '16px', fontFamily: 'sans-serif' }),
        requestAnimationFrame: (callback) => {
            frames.set(++nextId, callback);
            return nextId;
        },
        cancelAnimationFrame: (id) => frames.delete(id),
        ResizeObserver: class {
            constructor(callback) {
                observe = callback;
            }
            observe() {}
            disconnect() {}
        },
        logError: (error) => {
            throw new Error(error);
        },
    });
    const cleanup = vm.runInContext(`(${effect})()`, context);
    return {
        calls,
        textarea,
        root,
        frames,
        listeners,
        cleanup,
        observe: () => observe(),
        frame() {
            assert.equal(frames.size, 1);
            const [id, callback] = frames.entries().next().value;
            frames.delete(id);
            return callback();
        },
    };
}

test('unchanged layouts reuse text measurements and monitor data; moving invalidates monitor cache', async () => {
    const fit = autoFit();
    fit.observe();
    await fit.frame();
    for (let i = 0; i < 10; i++) fit.observe();
    await fit.frame();
    assert.equal(fit.calls.monitor, 1);
    assert.equal(fit.calls.measure, 1);
    assert.equal(fit.calls.sizes.length, 1);
    fit.textarea.value = 'a longer result';
    fit.observe();
    await fit.frame();
    assert.equal(fit.calls.measure, 2);
    fit.listeners.get('move')();
    await fit.frame();
    assert.equal(fit.calls.monitor, 2);
    fit.cleanup();
    assert.equal(fit.listeners.size, 0);
});

test('resize requests remain serial and use latest dimensions after an in-flight update', async () => {
    let release;
    let began;
    const started = new Promise((resolve) => {
        began = resolve;
    });
    const fit = autoFit({
        resize: () =>
            new Promise((resolve) => {
                release = resolve;
                began();
            }),
    });
    fit.observe();
    const first = fit.frame();
    await started;
    fit.root.offsetHeight = 400;
    for (let i = 0; i < 10; i++) fit.observe();
    assert.equal(fit.frames.size, 0);
    assert.equal(fit.calls.sizes.length, 1);
    release();
    await first;
    const second = fit.frame();
    assert.equal(fit.calls.sizes.length, 2);
    assert.equal(fit.calls.sizes[1].height, 435);
    release();
    await second;
    fit.cleanup();
});

test('unmount during monitor lookup prevents a late window resize and releases listeners', async () => {
    let resolve;
    const fit = autoFit({
        monitor: () =>
            new Promise((done) => {
                resolve = done;
            }),
    });
    fit.observe();
    const pending = fit.frame();
    fit.cleanup();
    resolve({ scaleFactor: 1, size: { width: 1920, height: 1080 } });
    await pending;
    assert.equal(fit.calls.sizes.length, 0);
    assert.equal(fit.listeners.size, 0);
    assert.equal(fit.frames.size, 0);
});

function openaiProvider(browserFetch, warmup = async () => {}) {
    const file = parse('../../services/translate/openai/index.jsx');
    const functions = file.statements
        .filter(ts.isFunctionDeclaration)
        .map((node) => node.getText(file).replace(/^export /, ''))
        .join('\n');
    let fallbacks = 0;
    const context = vm.createContext({
        window: { fetch: browserFetch },
        fetch: async () => {
            fallbacks++;
            throw new Error('unexpected fallback');
        },
        Body: { json: (value) => value },
        URL,
        TextDecoder,
        TypeError,
        ensureOllamaReady: warmup,
        createRequestHeaders: () => ({}),
        defaultRequestArguments: '{}',
        Language: { en: 'English' },
    });
    vm.runInContext(`${functions}\nglobalThis.run = translate;`, context);
    return {
        run: (signal, requestPath = 'https://example.test/v1/chat/completions') =>
            context.run('hello', 'English', 'Chinese', {
                signal,
                detect: 'en',
                setResult() {},
                config: { service: 'openai', requestPath, stream: true },
            }),
        fallbacks: () => fallbacks,
    };
}

test('aborting a stream passes the signal to fetch, releases its reader, and does not retry', async () => {
    const controller = new AbortController();
    let reading;
    const started = new Promise((resolve) => {
        reading = resolve;
    });
    let released = false;
    const provider = openaiProvider(async (_, options) => {
        assert.equal(options.signal, controller.signal);
        return {
            ok: true,
            body: {
                getReader: () => ({
                    read: () =>
                        new Promise((resolve, reject) => {
                            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
                                once: true,
                            });
                            reading();
                        }),
                    releaseLock: () => {
                        released = true;
                    },
                }),
            },
        };
    });
    const pending = provider.run(controller.signal);
    await started;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(released, true);
    assert.equal(provider.fallbacks(), 0);
});

test('a request cancelled during model warmup never starts its translation transport', async () => {
    const controller = new AbortController();
    let finishWarmup;
    let transports = 0;
    const provider = openaiProvider(
        async () => {
            transports++;
        },
        () =>
            new Promise((resolve) => {
                finishWarmup = resolve;
            })
    );
    const pending = provider.run(controller.signal, 'http://localhost:11434/v1/chat/completions');
    controller.abort();
    finishWarmup();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(transports, 0);
    assert.equal(provider.fallbacks(), 0);
});
