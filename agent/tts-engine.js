/**
 * TTS Engine — Edge TTS wrapper for Octiv voice announcements
 *
 * Converts text to audio streams using Microsoft Edge TTS (free, no API key).
 * Returns readable streams that can be piped into @discordjs/voice AudioResource.
 */

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
 * Internal: override for testing. Set to a factory function
 * that returns { synthesize(text, voice, opts), toReadable() }.
 */
let _ttsFactory = null;

/**
 * Set a custom TTS factory (for testing).
 * @param {Function|null} factory - () => { synthesize, toReadable }
 */
function _setTtsFactory(factory) {
  _ttsFactory = factory;
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

  try {
    let tts;
    if (_ttsFactory) {
      tts = _ttsFactory();
    } else {
      const { EdgeTTS } = require('node-edge-tts');
      tts = new EdgeTTS();
    }
    await tts.synthesize(truncated, selectedVoice, { rate: '+0%', pitch: '+0Hz' });
    const stream = tts.toReadable();
    return stream;
  } catch (err) {
    log.error('tts-engine', 'synthesis failed', { error: err.message, voice: selectedVoice });
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
