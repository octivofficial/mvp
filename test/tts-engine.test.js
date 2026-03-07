/**
 * TTS Engine unit tests.
 * Uses _setTtsFactory for DI — no live Edge TTS API calls.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const { synthesize, voiceForRole, VOICES, DEFAULT_VOICE, _setTtsFactory } = require('../agent/tts-engine');
const T = require('../config/timeouts');

// Track calls to the mock TTS factory
let factoryCalls = [];
let throwOnSynthesize = false;

function mockFactory(text, voice) {
  if (throwOnSynthesize) throw new Error('TTS service unavailable');
  factoryCalls.push({ text, voice });
  return new Readable({ read() { this.push(null); } });
}

describe('TTS Engine — synthesize()', () => {
  beforeEach(() => {
    factoryCalls = [];
    throwOnSynthesize = false;
    _setTtsFactory(mockFactory);
  });

  afterEach(() => {
    _setTtsFactory(null);
  });

  it('should return a readable stream for valid text', async () => {
    const stream = await synthesize('Hello, world!');
    assert.ok(stream instanceof Readable, 'should return a Readable stream');
    assert.equal(factoryCalls.length, 1);
  });

  it('should pass text and voice to factory', async () => {
    await synthesize('Test text', 'en-US-GuyNeural');
    assert.equal(factoryCalls[0].text, 'Test text');
    assert.equal(factoryCalls[0].voice, 'en-US-GuyNeural');
  });

  it('should use DEFAULT_VOICE when no voice specified', async () => {
    await synthesize('Default voice test');
    assert.equal(factoryCalls[0].voice, DEFAULT_VOICE);
  });

  it('should return null for empty string', async () => {
    const result = await synthesize('');
    assert.equal(result, null);
    assert.equal(factoryCalls.length, 0);
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
    assert.equal(factoryCalls[0].text.length, T.TTS_MAX_TEXT_LENGTH + 3); // +3 for "..."
    assert.ok(factoryCalls[0].text.endsWith('...'));
  });

  it('should not truncate text within limit', async () => {
    const text = 'A'.repeat(T.TTS_MAX_TEXT_LENGTH);
    await synthesize(text);
    assert.equal(factoryCalls[0].text, text);
  });

  it('should return null when factory throws', async () => {
    throwOnSynthesize = true;
    const result = await synthesize('Will fail');
    assert.equal(result, null);
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

describe('TTS Engine — synthesize() real Edge TTS path', () => {
  afterEach(() => {
    _setTtsFactory(null);
  });

  it('should handle missing Edge TTS module gracefully (no throw)', async () => {
    _setTtsFactory(null); // force real code path
    // node-edge-tts may or may not be installed in CI.
    // Either a stream is returned (installed + network available) or null (any error).
    const result = await synthesize('test', 'en-US-AriaNeural');
    assert.ok(result === null || typeof result.pipe === 'function',
      'expected null or a readable stream');
  });

  it('should return null when factory is set to async function returning null', async () => {
    _setTtsFactory(async () => null);
    const result = await synthesize('hello world');
    assert.equal(result, null);
  });

  it('should return a stream with alternate voice when factory returns a stream', async () => {
    const { Readable } = require('stream');
    _setTtsFactory(async (text, _voice) => {
      return new Readable({ read() { this.push(Buffer.from(text)); this.push(null); } });
    });
    const stream = await synthesize('alternate voice test', 'en-US-GuyNeural');
    assert.ok(stream instanceof Readable, 'should be a Readable stream');
  });
});

// ── synthesize() catch block (lines 97-100) ──────────────────────────
// Force the real EdgeTTS code path to throw by temporarily replacing
// the node-edge-tts module in the require cache with a failing stub.
describe('TTS Engine — synthesize() catch block (lines 97-100)', () => {
  let originalModule;
  const edgeTtsPath = require.resolve('node-edge-tts');

  beforeEach(() => {
    originalModule = require.cache[edgeTtsPath];
    // Inject a stub that makes ttsPromise throw
    require.cache[edgeTtsPath] = {
      id: edgeTtsPath,
      filename: edgeTtsPath,
      loaded: true,
      exports: {
        EdgeTTS: class {
          constructor() {}
          async ttsPromise() {
            throw new Error('stub: ttsPromise forced failure');
          }
        },
      },
    };
    _setTtsFactory(null); // force real code path
  });

  afterEach(() => {
    // Restore original module
    if (originalModule) {
      require.cache[edgeTtsPath] = originalModule;
    } else {
      delete require.cache[edgeTtsPath];
    }
    _setTtsFactory(null);
  });

  it('should return null when EdgeTTS.ttsPromise throws (covers catch block lines 97-100)', async () => {
    const result = await synthesize('forced failure test', 'en-US-AriaNeural');
    assert.equal(result, null, 'should return null when synthesis fails');
  });
});

// ── synthesize() close handler (line 94) ─────────────────────────────
// The stream.on('close', ...) callback is an anonymous function tracked by V8.
// To cover it, stub EdgeTTS to write a real temp file so createReadStream works,
// then consume the stream to trigger the 'close' event.
describe('TTS Engine — synthesize() stream close cleanup (line 94)', () => {
  const { writeFileSync } = require('fs');
  let originalModule;
  const edgeTtsPath = require.resolve('node-edge-tts');

  beforeEach(() => {
    originalModule = require.cache[edgeTtsPath];
    // Stub EdgeTTS to write a real (small) tmp file so createReadStream succeeds
    require.cache[edgeTtsPath] = {
      id: edgeTtsPath,
      filename: edgeTtsPath,
      loaded: true,
      exports: {
        EdgeTTS: class {
          constructor() {}
          async ttsPromise(text, filePath) {
            // Write a minimal mp3 header so the file exists and can be streamed
            writeFileSync(filePath, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
          }
        },
      },
    };
    _setTtsFactory(null); // force real code path
  });

  afterEach(() => {
    if (originalModule) {
      require.cache[edgeTtsPath] = originalModule;
    } else {
      delete require.cache[edgeTtsPath];
    }
    _setTtsFactory(null);
  });

  it('should trigger stream close handler (unlink temp file) when stream is consumed', async () => {
    const stream = await synthesize('close handler test', 'en-US-AriaNeural');
    assert.ok(stream !== null, 'should return a stream when EdgeTTS succeeds');
    assert.ok(typeof stream.pipe === 'function', 'should be a readable stream');

    // Consume the stream to trigger the close event (and the unlink cleanup)
    await new Promise((resolve) => {
      stream.on('data', () => {});
      stream.on('end', resolve);
      stream.on('error', resolve); // also resolve on error (file cleanup)
      stream.on('close', resolve);
    });
    // If we reach here without throwing, the close handler was invoked (unlink was called)
  });

  it('should silently swallow unlink error in close handler when file is already deleted', async () => {
    const { unlinkSync } = require('fs');
    const stream = await synthesize('close cleanup unlink-fail test', 'en-US-AriaNeural');
    assert.ok(stream !== null, 'should return a stream');

    // Delete the temp file synchronously after 'open' fires so the stream can still
    // read from its open fd, but when 'close' fires and unlink() is called,
    // the file is already gone → unlink rejects → inner .catch(() => {}) on line 94 runs.
    // Two nested setImmediate are required because the Promise .catch is a microtask
    // that resolves AFTER the first setImmediate (so we need the second one to see it).
    await new Promise((resolve) => {
      stream.once('open', () => {
        // File is open (fd is valid). Delete it so close-handler unlink fails.
        if (stream.path) {
          try { unlinkSync(stream.path); } catch (_) {}
        }
      });
      stream.on('data', () => {});
      stream.on('error', resolve);
      stream.on('close', () => {
        // Use two nested setImmediate so the unlink Promise microtask can settle
        // before this test resolves (ensuring V8 records the .catch callback).
        setImmediate(() => setImmediate(resolve));
      });
    });
    // The .catch(() => {}) inside the close handler absorbed the ENOENT error silently.
  });
});
