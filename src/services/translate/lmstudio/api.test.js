import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createLmStudioHeaders,
    expandCodeIdentifierForTranslation,
    getChatCompletionsUrl,
    getModelsUrl,
    LM_STUDIO_DEFAULT_PROMPT_LIST,
    normalizeBaseUrl,
    parseModelIds,
    toOpenAIConfig,
} from './api.js';
import { Language } from './language.js';

test('normalizes LM Studio base URLs to one v1 segment', () => {
    assert.equal(normalizeBaseUrl('http://localhost:1234'), 'http://localhost:1234/v1');
    assert.equal(normalizeBaseUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1');
    assert.equal(normalizeBaseUrl('http://localhost:1234/v1/chat/completions'), 'http://localhost:1234/v1');
});

test('builds the LM Studio model and chat endpoints', () => {
    assert.equal(getModelsUrl('http://localhost:1234'), 'http://localhost:1234/v1/models');
    assert.equal(getChatCompletionsUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1/chat/completions');
});

test('only sends bearer authorization for a non-empty token', () => {
    assert.deepEqual(createLmStudioHeaders(''), { 'Content-Type': 'application/json' });
    assert.deepEqual(createLmStudioHeaders(' token '), {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
    });
});

test('parses model identifiers from the OpenAI-compatible response', () => {
    assert.deepEqual(parseModelIds({ data: [{ id: 'qwen' }, { id: 'gemma' }] }), ['qwen', 'gemma']);
    assert.throws(() => parseModelIds({ models: [] }), /Invalid LM Studio models response/);
});

test('adapts LM Studio configuration to the existing OpenAI provider', () => {
    const config = toOpenAIConfig({ baseUrl: 'http://localhost:1234', model: 'qwen', apiKey: '' });
    assert.equal(config.service, 'openai');
    assert.equal(config.requestPath, 'http://localhost:1234/v1/chat/completions');
    assert.equal(config.model, 'qwen');
});

test('removes line breaks from LM Studio prompt templates', () => {
    const config = toOpenAIConfig({
        baseUrl: 'http://localhost:1234',
        promptList: [
            { role: 'system', content: '专业翻译机器人\n\n' },
            { role: 'user', content: '把以下内容从 \r\n$from \n翻译成 $to。\n\n$text' },
        ],
    });

    assert.deepEqual(config.promptList, [
        { role: 'system', content: '专业翻译机器人' },
        { role: 'user', content: '把以下内容从 $from 翻译成 $to。$text' },
    ]);
});

test('uses Chinese default prompts for new LM Studio services', () => {
    assert.deepEqual(LM_STUDIO_DEFAULT_PROMPT_LIST, [
        { role: 'system', content: '你是专业翻译机器人，只输出准确、自然的译文，不要解释。' },
        { role: 'user', content: '把以下内容从 $from 翻译成 $to：$text' },
    ]);
    assert.ok(LM_STUDIO_DEFAULT_PROMPT_LIST.every(({ content }) => !/[\r\n]/.test(content)));
});

test('uses Chinese language names for LM Studio prompt variables', () => {
    assert.deepEqual(Language, {
        auto: '自动检测',
        zh_cn: '简体中文',
        zh_tw: '繁体中文',
        yue: '粤语',
        ja: '日语',
        en: '英语',
        ko: '韩语',
        fr: '法语',
        es: '西班牙语',
        ru: '俄语',
        de: '德语',
        it: '意大利语',
        tr: '土耳其语',
        pt_pt: '葡萄牙语',
        pt_br: '巴西葡萄牙语',
        vi: '越南语',
        id: '印度尼西亚语',
        th: '泰语',
        ms: '马来语',
        ar: '阿拉伯语',
        hi: '印地语',
        mn_mo: '蒙古语',
        mn_cy: '蒙古语（西里尔文）',
        km: '高棉语',
        nb_no: '书面挪威语',
        nn_no: '新挪威语',
        fa: '波斯语',
        sv: '瑞典语',
        pl: '波兰语',
        nl: '荷兰语',
        uk: '乌克兰语',
        he: '希伯来语',
    });
});

test('expands single code identifiers before LM Studio translation', () => {
    assert.equal(expandCodeIdentifierForTranslation('getScheduler'), 'get scheduler');
    assert.equal(expandCodeIdentifierForTranslation('GetScheduler'), 'get scheduler');
    assert.equal(expandCodeIdentifierForTranslation('get_scheduler'), 'get scheduler');
    assert.equal(expandCodeIdentifierForTranslation('get-scheduler'), 'get scheduler');
    assert.equal(expandCodeIdentifierForTranslation('DEFAULT_SCHEDULER'), 'default scheduler');
});

test('does not rewrite prose or non-identifier text before LM Studio translation', () => {
    assert.equal(expandCodeIdentifierForTranslation('hello world'), 'hello world');
    assert.equal(expandCodeIdentifierForTranslation('scheduler'), 'scheduler');
    assert.equal(expandCodeIdentifierForTranslation('getScheduler()'), 'getScheduler()');
});
