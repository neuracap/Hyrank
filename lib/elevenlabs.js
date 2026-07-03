/**
 * ElevenLabs text-to-speech helper (REST, no SDK).
 *
 * Env:
 *   ELEVENLABS_API_KEY   required to generate audio
 *   ELEVENLABS_VOICE_ID  optional; defaults to a multilingual voice ("Rachel")
 *   ELEVENLABS_MODEL_ID  optional; defaults to eleven_multilingual_v2 (handles Hindi/Hinglish)
 *
 * The transcripts are Hinglish (Devanagari + Roman). eleven_multilingual_v2 renders
 * both; the model auto-detects language from the text.
 */

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // "Rachel"
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

export function elevenLabsConfigured() {
    return Boolean(process.env.ELEVENLABS_API_KEY);
}

/**
 * Generate speech for `text`. Returns a Node Buffer of MP3 audio.
 * Throws with a descriptive message on failure.
 */
export async function generateSpeech(text, { voiceId = DEFAULT_VOICE_ID, modelId = DEFAULT_MODEL_ID } = {}) {
    if (!process.env.ELEVENLABS_API_KEY) {
        throw new Error('ELEVENLABS_API_KEY not configured');
    }
    const clean = (text || '').trim();
    if (!clean) throw new Error('No text to synthesize');

    const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
            method: 'POST',
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
                Accept: 'audio/mpeg',
            },
            body: JSON.stringify({
                text: clean,
                model_id: modelId,
                voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
            }),
        }
    );

    if (!res.ok) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const j = await res.json();
            detail = j?.detail?.message || j?.detail || JSON.stringify(j);
        } catch { /* non-JSON error body */ }
        throw new Error(`ElevenLabs TTS failed: ${detail}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
