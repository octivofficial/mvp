/**
 * TTS Engine — Edge TTS wrapper for Octiv voice announcements
 *
 * Converts text to audio streams using Microsoft Edge TTS (free, no API key).
 * Returns readable streams that can be piped into @discordjs/voice AudioResource.
 */

const { createReadStream } = require('fs');
const { unlink } = require('fs/promises');
const { join } = require('path');
const { randomBytes } = require('crypto');
const os = require('os');
const { getLogger } = require('./logger');
const T = require('../config/timeouts');

const log = getLogger();

/** Voice presets per agent role */
const VOICES = {
  korean: {
    female: 'ko-KR-SunHiNeural',
    male: 'ko-KR-InJoonNeural',
  },
  english: {
    female: 'en-US-AriaNeural',
    male: 'en-US-GuyNeural',
  },
  // Agent-specific voices
  leader: 'ko-KR-InJoonNeural',
  builder: 'ko-KR-SunHiNeural',
  safety: 'en-US-GuyNeural',
  explorer: 'en-US-AriaNeural',
};

const DEFAULT_VOICE = VOICES.english.female;

/**
 * Internal: override for testing. Set to a function matching
 *   async (text, voice) => ReadableStream | null
 */
let _ttsFactory = null;

/**
 * Set a custom TTS factory (for testing).
 * @param {Function|null} factory - async (text, voice) => ReadableStream | null
 */
function _setTtsFactory(factory) {
  _ttsFactory = factory;
}

/**
 * Generate a temp file path for TTS audio.
 */
function _tmpPath() {
  const id = randomBytes(8).toString('hex');
  return join(os.tmpdir(), `octiv-tts-${id}.mp3`);
}

/**
 * Synthesize text to an audio stream via Edge TTS.
 * @param {string} text - Text to synthesize
 * @param {string} [voice] - Edge TTS voice name (defaults to AriaNeural)
 * @returns {Promise<import('stream').Readable|null>} Audio stream or null on error/empty
 */
async function synthesize(text, voice) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  // Truncate long text
  const truncated = text.length > T.TTS_MAX_TEXT_LENGTH
    ? text.slice(0, T.TTS_MAX_TEXT_LENGTH) + '...'
    : text;

  const selectedVoice = voice || DEFAULT_VOICE;

  // Test override
  if (_ttsFactory) {
    try {
      return await _ttsFactory(truncated, selectedVoice);
    } catch (err) {
      log.error('tts-engine', 'test factory failed', { error: err.message });
      return null;
    }
  }

  const tmpFile = _tmpPath();
  try {
    const { EdgeTTS } = require('node-edge-tts');
    const tts = new EdgeTTS({ voice: selectedVoice, rate: '+0%', pitch: '+0Hz' });
    await tts.ttsPromise(truncated, tmpFile);
    const stream = createReadStream(tmpFile);
    // Clean up temp file after stream is consumed
    stream.on('close', () => unlink(tmpFile).catch(() => {}));
    return stream;
  } catch (err) {
    log.error('tts-engine', 'synthesis failed', { error: err.message, voice: selectedVoice });
    unlink(tmpFile).catch(() => {});
    return null;
  }
}

/**
 * Get the voice preset for an agent role.
 * @param {string} role - Agent role (leader, builder, safety, explorer)
 * @returns {string} Edge TTS voice name
 */
function voiceForRole(role) {
  return VOICES[role] || DEFAULT_VOICE;
}

module.exports = { synthesize, voiceForRole, VOICES, DEFAULT_VOICE, _setTtsFactory };
