/**
 * TTS Engine unit tests.
 * Uses _setTtsFactory for DI — no live Edge TTS API calls.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const { synthesize, voiceForRole, VOICES, DEFAULT_VOICE, _setTtsFactory } = require('../agent/tts-engine');
const T = require('../config/timeouts');

// Track calls to the mock TTS
let synthesizeCalls = [];
let toReadableCalls = [];
let throwOnSynthesize = false;

function createMockTts() {
  return {
    synthesize: async (text, voice, opts) => {
      if (throwOnSynthesize) throw new Error('TTS service unavailable');
      synthesizeCalls.push({ text, voice, opts });
    },
    toReadable: () => {
      toReadableCalls.push(true);
      return new Readable({ read() { this.push(null); } });
    },
  };
}

describe('TTS Engine — synthesize()', () => {
  beforeEach(() => {
    synthesizeCalls = [];
    toReadableCalls = [];
    throwOnSynthesize = false;
    _setTtsFactory(() => createMockTts());
  });

  afterEach(() => {
    _setTtsFactory(null);
  });

  it('should return a readable stream for valid text', async () => {
    const stream = await synthesize('Hello, world!');
    assert.ok(stream instanceof Readable, 'should return a Readable stream');
    assert.equal(synthesizeCalls.length, 1);
    assert.equal(toReadableCalls.length, 1);
  });

  it('should pass text and voice to EdgeTTS.synthesize()', async () => {
    await synthesize('Test text', 'en-US-GuyNeural');
    assert.equal(synthesizeCalls[0].text, 'Test text');
    assert.equal(synthesizeCalls[0].voice, 'en-US-GuyNeural');
  });

  it('should use DEFAULT_VOICE when no voice specified', async () => {
    await synthesize('Default voice test');
    assert.equal(synthesizeCalls[0].voice, DEFAULT_VOICE);
  });

  it('should return null for empty string', async () => {
    const result = await synthesize('');
    assert.equal(result, null);
    assert.equal(synthesizeCalls.length, 0);
  });

  it('should return null for null input', async () => {
    const result = await synthesize(null);
    assert.equal(result, null);
  });

  it('should return null for undefined input', async () => {
    const result = await synthesize(undefined);
    assert.equal(result, null);
  });

  it('should return null for non-string input', async () => {
    const result = await synthesize(42);
    assert.equal(result, null);
  });

  it('should return null for whitespace-only string', async () => {
    const result = await synthesize('   \n\t  ');
    assert.equal(result, null);
  });

  it('should truncate text longer than TTS_MAX_TEXT_LENGTH', async () => {
    const longText = 'A'.repeat(T.TTS_MAX_TEXT_LENGTH + 100);
    await synthesize(longText);
    assert.equal(synthesizeCalls[0].text.length, T.TTS_MAX_TEXT_LENGTH + 3); // +3 for "..."
    assert.ok(synthesizeCalls[0].text.endsWith('...'));
  });

  it('should not truncate text within limit', async () => {
    const text = 'A'.repeat(T.TTS_MAX_TEXT_LENGTH);
    await synthesize(text);
    assert.equal(synthesizeCalls[0].text, text);
  });

  it('should return null when EdgeTTS.synthesize throws', async () => {
    throwOnSynthesize = true;
    const result = await synthesize('Will fail');
    assert.equal(result, null);
  });

  it('should pass rate and pitch options', async () => {
    await synthesize('With options');
    assert.deepEqual(synthesizeCalls[0].opts, { rate: '+0%', pitch: '+0Hz' });
  });
});

describe('TTS Engine — voiceForRole()', () => {
  it('should return leader voice', () => {
    assert.equal(voiceForRole('leader'), VOICES.leader);
  });

  it('should return builder voice', () => {
    assert.equal(voiceForRole('builder'), VOICES.builder);
  });

  it('should return safety voice', () => {
    assert.equal(voiceForRole('safety'), VOICES.safety);
  });

  it('should return explorer voice', () => {
    assert.equal(voiceForRole('explorer'), VOICES.explorer);
  });

  it('should return DEFAULT_VOICE for unknown role', () => {
    assert.equal(voiceForRole('unknown'), DEFAULT_VOICE);
  });

  it('should return DEFAULT_VOICE for empty string', () => {
    assert.equal(voiceForRole(''), DEFAULT_VOICE);
  });

  it('should return DEFAULT_VOICE for undefined', () => {
    assert.equal(voiceForRole(undefined), DEFAULT_VOICE);
  });
});

describe('TTS Engine — VOICES constant', () => {
  it('should have Korean voices', () => {
    assert.ok(VOICES.korean.female);
    assert.ok(VOICES.korean.male);
    assert.ok(VOICES.korean.female.includes('ko-KR'));
    assert.ok(VOICES.korean.male.includes('ko-KR'));
  });

  it('should have English voices', () => {
    assert.ok(VOICES.english.female);
    assert.ok(VOICES.english.male);
    assert.ok(VOICES.english.female.includes('en-US'));
    assert.ok(VOICES.english.male.includes('en-US'));
  });

  it('should have agent role voices', () => {
    assert.ok(VOICES.leader);
    assert.ok(VOICES.builder);
    assert.ok(VOICES.safety);
    assert.ok(VOICES.explorer);
  });
});
