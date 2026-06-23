import { translate as translateWithOpenAI } from '../openai';
import { expandCodeIdentifierForTranslation, toOpenAIConfig } from './api';

export async function translate(text, from, to, options = {}) {
    return translateWithOpenAI(expandCodeIdentifierForTranslation(text), from, to, {
        ...options,
        config: toOpenAIConfig(options.config),
    });
}

export * from './Config';
export * from './info';
