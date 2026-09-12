export const chineseVoices = ['zh-CN-XiaoxiaoNeural'];
export const englishVoices = ['en-US-JennyNeural', 'en-GB-SoniaNeural'];

export const defaultConfig = {
    chineseVoice: chineseVoices[0],
    englishVoice: englishVoices[0],
};

export function selectVoice(lang, config = {}) {
    if (lang === 'zh') {
        return chineseVoices.includes(config.chineseVoice) ? config.chineseVoice : defaultConfig.chineseVoice;
    }
    if (lang === 'en') {
        return englishVoices.includes(config.englishVoice) ? config.englishVoice : defaultConfig.englishVoice;
    }
    throw new Error('Language not supported');
}
