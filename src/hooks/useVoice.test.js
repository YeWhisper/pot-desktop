import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./useVoice.jsx', import.meta.url), 'utf8')
    .replace("import { useCallback } from 'react';", 'const useCallback = (callback) => callback;')
    .replace('export const useVoice', 'globalThis.useVoice');

function setup(decode = async () => ({})) {
    const nodes = [];
    let contexts = 0;
    class AudioContext {
        constructor() {
            contexts++;
        }
        async resume() {}
        decodeAudioData(data) {
            return decode(data);
        }
        createBufferSource() {
            const node = {
                connect() {},
                start() {
                    this.started = true;
                },
                stop() {
                    this.stopped = true;
                },
                disconnect() {
                    this.disconnected = true;
                },
            };
            nodes.push(node);
            return node;
        }
    }
    const context = vm.createContext({ window: { AudioContext } });
    vm.runInContext(code, context);
    return { speak: context.useVoice(), nodes, contextCount: () => contexts };
}

test('does not create an audio engine until playback and reuses it afterwards', async () => {
    const { speak, nodes, contextCount } = setup();
    assert.equal(contextCount(), 0);
    await speak([1]);
    assert.equal(contextCount(), 1);
    nodes[0].onended();
    await speak([2]);
    assert.equal(contextCount(), 1);
});

test('a delayed ended event from stopped audio does not interrupt new playback', async () => {
    const { speak, nodes } = setup();
    await speak([1]);
    await speak([1]);
    assert.equal(nodes[0].stopped, true);
    await speak([2]);
    nodes[0].onended();
    assert.equal(nodes[0].disconnected, true);
    assert.equal(nodes[1].disconnected, undefined);
    await speak([2]);
    assert.equal(nodes[1].stopped, true);
});

test('decoding failures reach the caller for error feedback', async () => {
    const { speak } = setup(async () => {
        throw new Error('Invalid audio');
    });
    await assert.rejects(speak([]), /Invalid audio/);
});

test('the latest preview wins when decoding overlaps', async () => {
    const decoders = [];
    const { speak, nodes } = setup(() => new Promise((resolve) => decoders.push(resolve)));
    const first = speak([1]);
    const second = speak([2]);
    await new Promise(setImmediate);
    decoders[1]({});
    await second;
    decoders[0]({});
    await first;
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].started, true);
});
