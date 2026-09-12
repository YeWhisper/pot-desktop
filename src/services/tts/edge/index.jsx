import { invoke } from '@tauri-apps/api/tauri';
import { selectVoice } from './voices';

export async function tts(text, lang, { config = {} } = {}) {
    return invoke('edge_tts', { text, voice: selectVoice(lang, config) });
}

export * from './Config';
export * from './info';
