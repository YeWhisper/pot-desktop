import { translate as translateWithOpenAI } from '../openai';
import { expandCodeIdentifierForTranslation, toOpenAIConfig } from './api';
import { waitForLmStudioWarmup } from '../../../utils/lmstudio_warmup';

export async function translate(text, from, to, options = {}) {
    options.signal?.throwIfAborted();
    // Avoid racing explicit startup loading with LM Studio's just-in-time loading.
    await waitForLmStudioWarmup();
    options.signal?.throwIfAborted();
    return translateWithOpenAI(expandCodeIdentifierForTranslation(text), from, to, {
        ...options,
        config: toOpenAIConfig(options.config),
    });
}

export * from './Config';
export * from './info';
