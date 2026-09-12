import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real effect bodies without starting a WebView or compiling the app.
const file = ts.createSourceFile(
    'App.jsx',
    readFileSync(new URL('./App.jsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX
);
const component = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === 'App');
const body = component.body.statements
    .filter((node) => !ts.isReturnStatement(node))
    .map((node) => node.getText(file))
    .join('\n');

function setup() {
    const keyboard = new Set();
    const themes = new Set();
    const config = { dev_mode: null, app_theme: 'system' };
    const calls = { close: 0, devtools: 0, themes: [] };
    const media = {
        matches: false,
        addEventListener: (_, handler) => themes.add(handler),
        removeEventListener: (_, handler) => themes.delete(handler),
    };
    let effects = [];
    let previous = [];
    const context = vm.createContext({
        useConfig: (key, fallback) => [key in config ? config[key] : fallback],
        useTheme: () => ({ setTheme: (value) => calls.themes.push(value) }),
        useTranslation: () => ({ i18n: { changeLanguage() {} } }),
        useEffect: (run, deps) => effects.push({ run, deps }),
        store: { load() {} },
        document: {
            documentElement: { style: {} },
            addEventListener: (_, handler) => keyboard.add(handler),
            removeEventListener: (_, handler) => keyboard.delete(handler),
        },
        window: { matchMedia: () => media },
        appWindow: { close: async () => calls.close++ },
        invoke: async () => calls.devtools++,
        warn() {},
    });
    vm.runInContext(`globalThis.renderApp = () => { ${body} };`, context);
    return {
        config,
        calls,
        keyboard,
        themes,
        render() {
            effects = [];
            context.renderApp();
            effects.forEach((effect, index) => {
                const old = previous[index];
                if (old && effect.deps.every((value, i) => Object.is(value, old.deps[i]))) {
                    effect.cleanup = old.cleanup;
                } else {
                    old?.cleanup?.();
                    effect.cleanup = effect.run();
                }
            });
            previous = effects;
        },
        unmount: () => previous.forEach((effect) => effect.cleanup?.()),
    };
}

test('loading and toggling developer mode keeps one keyboard listener', async () => {
    const app = setup();
    for (const value of [null, false, true, false, true]) {
        app.config.dev_mode = value;
        app.render();
        assert.equal(app.keyboard.size, 1);
    }
    for (const handler of app.keyboard) await handler({ key: 'Escape', preventDefault() {} });
    assert.equal(app.calls.close, 1);
    for (const handler of app.keyboard) await handler({ key: 'F12', preventDefault() {} });
    assert.equal(app.calls.devtools, 1);
    app.config.dev_mode = false;
    app.render();
    for (const handler of app.keyboard) await handler({ key: 'F12', preventDefault() {} });
    assert.equal(app.calls.devtools, 1);
    app.unmount();
    assert.equal(app.keyboard.size, 0);
});

test('theme changes release system listeners and do not override a fixed theme', () => {
    const app = setup();
    for (const theme of ['system', 'dark', 'system', 'light', 'system']) {
        app.config.app_theme = theme;
        app.render();
        assert.equal(app.themes.size, theme === 'system' ? 1 : 0);
    }
    for (const handler of app.themes) handler({ matches: true });
    assert.equal(app.calls.themes.at(-1), 'dark');
    app.config.app_theme = 'light';
    app.render();
    for (const handler of app.themes) handler({ matches: true });
    assert.equal(app.calls.themes.at(-1), 'light');
    app.unmount();
    assert.equal(app.themes.size, 0);
});
