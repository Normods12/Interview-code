// ============================================================
// tts.js — Text-to-Speech Module (Interview AI Platform v3)
// ============================================================
// Primary: Microsoft Edge TTS (neural voices, free)
// Fallback: Returns { fallback: true } so client uses WebSpeech
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EdgeTTS } = require('node-edge-tts');

const CACHE_DIR = path.join(__dirname, 'data', 'tts-cache');
const VOICE = 'en-US-ChristopherNeural'; // Stricter/formal voice

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Initialize TTS client
const tts = new EdgeTTS({
    voice: VOICE,
    lang: 'en-US',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    timeout: 30000 // 30s timeout
});

/**
 * Generate speech audio from text using Edge TTS.
 * Returns: { audioPath: string } on success
 *          { fallback: true } on failure (client should use WebSpeech)
 */
async function generateSpeech(text) {
    if (!text || text.trim().length === 0) {
        return { fallback: true };
    }

    // Hash text for cache key
    const hash = crypto.createHash('md5').update(text.trim()).digest('hex');
    const audioFile = path.join(CACHE_DIR, `${hash}.mp3`);

    // Return cached audio if available
    if (fs.existsSync(audioFile)) {
        return { audioPath: audioFile, cached: true };
    }

    try {
        await tts.ttsPromise(text.trim(), audioFile);
        console.log(`[TTS] Generated: ${text.substring(0, 50)}... → ${hash}.mp3`);
        return { audioPath: audioFile, cached: false };
    } catch (err) {
        console.warn(`[TTS] Edge TTS failed, falling back to WebSpeech:`, err.message);
        // Clean up partial file if exists
        if (fs.existsSync(audioFile)) {
            try { fs.unlinkSync(audioFile); } catch (e) { }
        }
        return { fallback: true, error: err.message };
    }
}

/**
 * Get audio file path from hash (for serving)
 */
function getAudioPath(hash) {
    const audioFile = path.join(CACHE_DIR, `${hash}.mp3`);
    if (fs.existsSync(audioFile)) return audioFile;
    return null;
}

/**
 * Clear TTS cache
 */
function clearCache() {
    if (fs.existsSync(CACHE_DIR)) {
        const files = fs.readdirSync(CACHE_DIR);
        files.forEach(f => fs.unlinkSync(path.join(CACHE_DIR, f)));
        console.log(`[TTS] Cache cleared: ${files.length} files removed`);
    }
}

module.exports = { generateSpeech, getAudioPath, clearCache };
