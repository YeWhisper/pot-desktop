import assert from 'node:assert/strict';
import test from 'node:test';
import { selectVoice } from './voices.js';

test('uses Mandarin for Chinese and American English by default', () => {
    assert.equal(selectVoice('zh'), 'zh-CN-XiaoxiaoNeural');
    assert.equal(selectVoice('en'), 'en-US-JennyNeural');
});

test('changing the English accent does not change the Chinese voice', () => {
    const config = { englishVoice: 'en-GB-SoniaNeural' };
    assert.equal(selectVoice('en', config), 'en-GB-SoniaNeural');
    assert.equal(selectVoice('zh', config), 'zh-CN-XiaoxiaoNeural');
});

test('invalid saved voices fall back, unsupported languages fail explicitly', () => {
    assert.equal(selectVoice('en', { englishVoice: 'zh-CN-XiaoxiaoNeural' }), 'en-US-JennyNeural');
    assert.throws(() => selectVoice('ja'), /Language not supported/);
});
