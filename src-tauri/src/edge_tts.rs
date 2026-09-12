use msedge_tts::tts::{
    client::tokio_runtime::{connect_async, connect_proxy_async},
    SpeechConfig,
};
use std::time::Duration;

const VOICES: [&str; 3] = [
    "zh-CN-XiaoxiaoNeural",
    "en-US-JennyNeural",
    "en-GB-SoniaNeural",
];

// The Edge protocol accepts SSML, so user text must remain plain text inside it.
fn escape_ssml(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[tauri::command]
pub async fn edge_tts(text: String, voice: String) -> Result<Vec<u8>, String> {
    if text.trim().is_empty() {
        return Err("Text is empty".into());
    }
    if !VOICES.contains(&voice.as_str()) {
        return Err("Unsupported Edge TTS voice".into());
    }
    let config = SpeechConfig {
        voice_name: voice,
        audio_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        pitch: 0,
        rate: 0,
        volume: 0,
    };
    // set_proxy() exposes Pot's proxy through these environment variables.
    let proxy = ["https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()));
    let synthesize = async {
        let mut audio = Vec::new();
        // Keep each escaped SSML request below the service's WebSocket message limit.
        let chars: Vec<char> = text.chars().collect();
        for chunk in chars.chunks(3000) {
            let text = escape_ssml(&chunk.iter().collect::<String>());
            let result = if let Some(proxy) = &proxy {
                connect_proxy_async(proxy)
                    .await
                    .map_err(|e| e.to_string())?
                    .synthesize(&text, &config)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                connect_async()
                    .await
                    .map_err(|e| e.to_string())?
                    .synthesize(&text, &config)
                    .await
                    .map_err(|e| e.to_string())?
            };
            if result.audio_bytes.is_empty() {
                return Err("Edge TTS returned no audio".to_string());
            }
            audio.extend(result.audio_bytes);
        }
        Ok(audio)
    };
    tokio::time::timeout(Duration::from_secs(90), synthesize)
        .await
        .map_err(|_| "Edge TTS request timed out".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_markup_and_removes_invalid_controls() {
        assert_eq!(
            escape_ssml("中文 <voice> & \"hi\" 'ok'\0\n"),
            "中文 &lt;voice&gt; &amp; &quot;hi&quot; &apos;ok&apos;\n"
        );
    }

    #[test]
    fn rejects_empty_text_and_unknown_voices() {
        tauri::async_runtime::block_on(async {
            assert!(edge_tts(" ".into(), VOICES[0].into()).await.is_err());
            assert!(edge_tts("hello".into(), "unknown".into()).await.is_err());
        });
    }

    #[test]
    #[ignore = "requires access to Microsoft's online speech service"]
    fn synthesizes_all_three_voices() {
        tauri::async_runtime::block_on(async {
            for voice in VOICES {
                let text = if voice.starts_with("zh") {
                    "你好，这是中文语音测试。"
                } else {
                    "Hello! This is a pronunciation test. One < two & three."
                };
                let audio = edge_tts(text.into(), voice.into()).await.unwrap();
                assert!(audio.len() > 1000, "No usable audio for {voice}");
                assert!(audio.starts_with(b"ID3") || (audio[0] == 0xff && audio[1] & 0xe0 == 0xe0));
                println!("{voice}: {} audio bytes", audio.len());
            }
        });
    }
}
