import { atom } from 'jotai';

// Translation always treats the input as English, regardless of saved detection settings.
export const SOURCE_LANGUAGE = 'en';
export const sourceTextAtom = atom('');
export const targetLanguageAtom = atom();
export const inlineTranslateAtom = atom(false);
