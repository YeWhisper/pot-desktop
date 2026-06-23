export const LM_STUDIO_DEFAULT_PROMPT_LIST = [
    { role: 'system', content: '你是专业翻译机器人，只输出准确、自然的译文，不要解释。' },
    { role: 'user', content: '把以下内容从 $from 翻译成 $to：$text' },
];

export function expandCodeIdentifierForTranslation(text) {
    const value = typeof text === 'string' ? text.trim() : '';
    if (!value || /\s/.test(value) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) return text;

    const expanded = value
        .replace(/[_-]+/g, ' ')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    return expanded.includes(' ') ? expanded : value;
}

export function normalizeBaseUrl(input) {
    let value = input.trim();
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`;

    const url = new URL(value);
    let pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    pathname = pathname.replace(/(?:\/v1)+$/i, '/v1');
    if (!pathname.endsWith('/v1')) pathname = `${pathname}/v1`;

    url.pathname = pathname;
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/$/, '');
}

export function getModelsUrl(baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}/models`;
}

export function getChatCompletionsUrl(baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

export function createLmStudioHeaders(apiKey = '') {
    const headers = { 'Content-Type': 'application/json' };
    const token = apiKey.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

export function parseModelIds(response) {
    if (!Array.isArray(response?.data)) throw new Error('Invalid LM Studio models response');
    return response.data.map((item) => item?.id).filter(Boolean);
}

export function toOpenAIConfig(config) {
    return {
        ...config,
        ...(Array.isArray(config.promptList) && {
            promptList: config.promptList.map((item) => ({
                ...item,
                content: item.content.replace(/[\r\n]/g, ''),
            })),
        }),
        service: 'openai',
        requestPath: getChatCompletionsUrl(config.baseUrl),
    };
}
