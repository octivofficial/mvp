/**
 * Voice Manager unit tests.
 * Uses _deps injection — no live Discord or TTS calls.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { EventEmitter } = require('events');

const { VoiceManager, Priority } = require('../agent/voice-manager');
const T = require('../config/timeouts');

// --- Mock factories ---

class MockAudioPlayer extends EventEmitter {
  constructor() {
    super();
    this.playedResources = [];
    this.stopped = false;
  }
  play(resource) { this.playedResources.push(resource); }
  stop(force) { this.stopped = force || true; }
}

function createMockConnection() {
  const conn = new EventEmitter();
  conn.subscribe = () => {};
  conn.destroy = () => {
    conn.emit('stateChange', {}, { status: 'destroyed' });
  };
  return conn;
}

function mockDeps(overrides = {}) {
  let player;
  const synthCalls = [];
  return {
    synthCalls,
    getPlayer: () => player,
    deps: {
      createAudioPlayer: () => {
        player = new MockAudioPlayer();
        return player;
      },
      joinVoiceChannel: (opts) => {
        const conn = createMockConnection();
        conn._joinArgs = opts;
        return conn;
      },
      synthesize: overrides.synthesize || (async (text, voice) => {
        synthCalls.push({ text, voice });
        return new Readable({ read() { this.push(null); } });
      }),
      createAudioResource: (stream) => ({ stream, _isResource: true }),
      ...overrides,
    },
  };
}

function createVM(opts = {}) {
  const { deps, ...rest } = mockDeps(opts._depsOverrides || {});
  const mockGuild = { voiceAdapterCreator: 'mock-adapter' };
  const channelId = 'channelId' in opts ? opts.channelId : 'voice-ch-1';
  const guildId = 'guildId' in opts ? opts.guildId : 'guild-1';
  const client = {
    guilds: {
      cache: {
        get: (id) => id === 'guild-1' ? mockGuild : null,
      },
    },
  };
  const vm = new VoiceManager(
    client,
    channelId,
    guildId,
    { maxQueue: opts.maxQueue, _deps: deps }
  );
  return { vm, deps, getPlayer: () => rest };
}

describe('VoiceManager — Constructor', () => {
  it('should set properties from constructor args', () => {
    const { vm } = createVM({ channelId: 'ch-123', guildId: 'g-456' });
    assert.equal(vm._channelId, 'ch-123');
    assert.equal(vm._guildId, 'g-456');
    assert.equal(vm._muted, false);
    assert.equal(vm._destroyed, false);
    assert.equal(vm._playing, false);
    assert.deepEqual(vm._queue, []);
  });

  it('should use TTS_QUEUE_MAX from config as default maxQueue', () => {
    const { vm } = createVM();
    assert.equal(vm._maxQueue, T.TTS_QUEUE_MAX);
  });

  it('should accept custom maxQueue', () => {
    const { vm } = createVM({ maxQueue: 5 });
    assert.equal(vm._maxQueue, 5);
  });
});

describe('VoiceManager — join()', () => {
  it('should call joinVoiceChannel with correct args', () => {
    const { vm } = createVM();
    const conn = vm.join();
    assert.ok(conn);
    assert.equal(conn._joinArgs.channelId, 'voice-ch-1');
    assert.equal(conn._joinArgs.guildId, 'guild-1');
  });

  it('should return existing connection on second call', () => {
    const { vm } = createVM();
    const c1 = vm.join();
    const c2 = vm.join();
    assert.strictEqual(c1, c2);
  });

  it('should return null if channelId is empty', () => {
    const { vm } = createVM({ channelId: '' });
    const conn = vm.join();
    assert.equal(conn, null);
  });

  it('should return null if guildId is empty', () => {
    const { vm } = createVM({ guildId: '' });
    const conn = vm.join();
    assert.equal(conn, null);
  });

  it('should return null if guild not found', () => {
    const { vm } = createVM({ guildId: 'nonexistent' });
    const conn = vm.join();
    assert.equal(conn, null);
  });
});

describe('VoiceManager — leave()', () => {
  it('should clear queue and mark destroyed', () => {
    const { vm } = createVM();
    vm.join();
    vm._queue = [{ text: 'a' }, { text: 'b' }];
    vm.leave();
    assert.deepEqual(vm._queue, []);
    assert.equal(vm._connection, null);
    assert.equal(vm._destroyed, true);
  });

  it('should not throw if called without join', () => {
    const { vm } = createVM();
    assert.doesNotThrow(() => vm.leave());
  });

  it('should stop player', () => {
    const { vm } = createVM();
    vm.join();
    vm.leave();
    assert.ok(vm._player.stopped);
  });
});

describe('VoiceManager — speak()', () => {
  it('should add item to queue', () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true; // prevent auto-processing
    const result = vm.speak('Hello');
    assert.equal(result, true);
    assert.equal(vm._queue.length, 1);
    assert.equal(vm._queue[0].text, 'Hello');
  });

  it('should default to NORMAL priority', () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true;
    vm.speak('test');
    assert.equal(vm._queue[0].priority, Priority.NORMAL);
  });

  it('should return false for empty text', () => {
    const { vm } = createVM();
    assert.equal(vm.speak(''), false);
    assert.equal(vm.speak(null), false);
    assert.equal(vm.speak(undefined), false);
  });

  it('should return false for non-string text', () => {
    const { vm } = createVM();
    assert.equal(vm.speak(42), false);
  });

  it('should return false when muted', () => {
    const { vm } = createVM();
    vm._muted = true;
    assert.equal(vm.speak('Hello'), false);
  });

  it('should return false when destroyed', () => {
    const { vm } = createVM();
    vm._destroyed = true;
    assert.equal(vm.speak('Hello'), false);
  });

  it('should reject when queue is full (normal priority)', () => {
    const { vm } = createVM({ maxQueue: 2 });
    vm.join();
    vm._playing = true;
    vm.speak('msg1');
    vm.speak('msg2');
    assert.equal(vm.speak('msg3'), false);
    assert.equal(vm._queue.length, 2);
  });

  it('should allow HIGH priority to bump lowest when queue full', () => {
    const { vm } = createVM({ maxQueue: 2 });
    vm.join();
    vm._playing = true;
    vm.speak('low1', { priority: Priority.LOW });
    vm.speak('low2', { priority: Priority.LOW });
    assert.equal(vm._queue.length, 2);

    const result = vm.speak('urgent', { priority: Priority.HIGH });
    assert.equal(result, true);
    assert.equal(vm._queue.length, 2);
    assert.equal(vm._queue[0].text, 'urgent');
    assert.equal(vm._queue[0].priority, Priority.HIGH);
  });

  it('should place HIGH priority before NORMAL in queue', () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true;
    vm.speak('normal1', { priority: Priority.NORMAL });
    vm.speak('normal2', { priority: Priority.NORMAL });
    vm.speak('urgent', { priority: Priority.HIGH });

    assert.equal(vm._queue[0].text, 'urgent');
    assert.equal(vm._queue[1].text, 'normal1');
  });

  it('should auto-join if not connected', () => {
    const { vm } = createVM();
    vm._playing = true; // prevent queue processing
    vm.speak('auto-join test');
    assert.ok(vm._connection);
  });

  it('should resolve role to voice via voiceForRole', () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true;
    vm.speak('Hello', { role: 'leader' });
    // voiceForRole('leader') returns a Korean voice
    assert.ok(vm._queue[0].voice);
  });

  it('should prefer explicit voice over role', () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true;
    vm.speak('Hello', { voice: 'custom-voice', role: 'leader' });
    assert.equal(vm._queue[0].voice, 'custom-voice');
  });
});

describe('VoiceManager — isConnected()', () => {
  it('should return false before join', () => {
    const { vm } = createVM();
    assert.equal(vm.isConnected(), false);
  });

  it('should return true after join', () => {
    const { vm } = createVM();
    vm.join();
    assert.equal(vm.isConnected(), true);
  });

  it('should return false after leave', () => {
    const { vm } = createVM();
    vm.join();
    vm.leave();
    assert.equal(vm.isConnected(), false);
  });
});

describe('VoiceManager — toggleMute()', () => {
  it('should toggle mute state', () => {
    const { vm } = createVM();
    assert.equal(vm.isMuted(), false);
    assert.equal(vm.toggleMute(), true);
    assert.equal(vm.isMuted(), true);
    assert.equal(vm.toggleMute(), false);
    assert.equal(vm.isMuted(), false);
  });
});

describe('VoiceManager — queueLength()', () => {
  it('should reflect current queue size', () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true;
    assert.equal(vm.queueLength(), 0);
    vm.speak('a');
    assert.equal(vm.queueLength(), 1);
    vm.speak('b');
    assert.equal(vm.queueLength(), 2);
  });
});

describe('VoiceManager — _processQueue()', () => {
  it('should not process when already playing', async () => {
    const m = mockDeps();
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm.join();
    vm._playing = true;
    vm._queue = [{ text: 'test', voice: null }];
    await vm._processQueue();
    assert.equal(m.synthCalls.length, 0);
  });

  it('should not process when queue is empty', async () => {
    const m = mockDeps();
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm.join();
    await vm._processQueue();
    assert.equal(m.synthCalls.length, 0);
  });

  it('should not process when destroyed', async () => {
    const m = mockDeps();
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm._destroyed = true;
    vm._queue = [{ text: 'test', voice: null }];
    await vm._processQueue();
    assert.equal(m.synthCalls.length, 0);
  });

  it('should not process when no connection', async () => {
    const m = mockDeps();
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm._queue = [{ text: 'test', voice: null }];
    await vm._processQueue();
    assert.equal(m.synthCalls.length, 0);
  });

  it('should call synthesize and play when queue has items', async () => {
    const m = mockDeps();
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm.join();
    vm._queue = [{ text: 'Hello', voice: 'en-US-AriaNeural' }];
    await vm._processQueue();

    assert.equal(m.synthCalls.length, 1);
    assert.equal(m.synthCalls[0].text, 'Hello');
    assert.ok(vm._playing);
    assert.ok(vm._player.playedResources.length > 0);
  });

  it('should skip to next item if synthesize returns null', async () => {
    let callCount = 0;
    const m = mockDeps({
      synthesize: async () => {
        callCount++;
        if (callCount === 1) return null;
        return new Readable({ read() { this.push(null); } });
      },
    });
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm.join();
    vm._queue = [
      { text: 'will-fail', voice: null },
      { text: 'will-succeed', voice: null },
    ];
    await vm._processQueue();
    // After null return from first, should process second
    assert.ok(callCount >= 1);
  });
});

describe('Priority constant', () => {
  it('should export LOW, NORMAL, HIGH', () => {
    assert.equal(Priority.LOW, 0);
    assert.equal(Priority.NORMAL, 1);
    assert.equal(Priority.HIGH, 2);
  });

  it('should order correctly: LOW < NORMAL < HIGH', () => {
    assert.ok(Priority.LOW < Priority.NORMAL);
    assert.ok(Priority.NORMAL < Priority.HIGH);
  });
});

describe('VoiceManager — player event handlers', () => {
  it('player error event sets playing=false and calls _processQueue', async () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true;

    // Trigger the error event on the player directly
    vm._player.emit('error', new Error('audio decode failed'));

    // After error handler runs synchronously: playing should be false
    assert.equal(vm._playing, false);
  });

  it('player idle event sets playing=false', () => {
    const { vm } = createVM();
    vm.join();
    vm._playing = true;

    // Trigger the idle event
    vm._player.emit('idle');

    assert.equal(vm._playing, false);
  });

  it('join returns null when guild is not found in cache', () => {
    const { vm } = createVM({ guildId: 'nonexistent-guild' });
    const conn = vm.join();
    assert.equal(conn, null);
  });

  it('join returns null when joinVoiceChannel throws', () => {
    const { deps, ...rest } = mockDeps({
      joinVoiceChannel: () => { throw new Error('voice module missing'); },
    });
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: deps });
    const conn = vm.join();
    assert.equal(conn, null);
  });

  it('_processQueue continues when synthesize throws', async () => {
    const m = mockDeps({
      synthesize: async () => { throw new Error('TTS service down'); },
    });
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm.join();
    vm._queue = [{ text: 'will-throw', voice: null }];

    // Should not throw, should reset playing
    await vm._processQueue();
    assert.equal(vm._playing, false);
  });

  it('_processQueue skips item when stream is null', async () => {
    const m = mockDeps({
      synthesize: async () => null,
    });
    const client = { guilds: { cache: { get: () => ({ voiceAdapterCreator: 'x' }) } } };
    const vm = new VoiceManager(client, 'ch', 'g', { _deps: m.deps });
    vm.join();
    vm._queue = [{ text: 'returns-null', voice: null }];

    await vm._processQueue();

    // After null stream, _playing should be reset
    assert.equal(vm._playing, false);
    // Queue should be empty (item was consumed)
    assert.equal(vm._queue.length, 0);
  });
});
