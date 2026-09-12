import { useCallback } from 'react';
let audioContext = null;
let source = null;
let playbackId = 0;

export const useVoice = () => {
    const playOrStop = useCallback(async (data) => {
        const id = ++playbackId;
        if (source) {
            // 如果正在播放，停止播放
            const playing = source;
            source = null;
            playing.stop();
        } else {
            // 如果没在播放，开始播放
            audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
            await audioContext.resume();
            const buffer = await audioContext.decodeAudioData(new Uint8Array(data).buffer);
            if (id !== playbackId) return;
            const playing = audioContext.createBufferSource();
            playing.buffer = buffer;
            playing.connect(audioContext.destination);
            playing.onended = () => {
                playing.disconnect();
                if (source === playing) source = null;
            };
            source = playing;
            playing.start();
        }
    }, []);

    return playOrStop;
};
