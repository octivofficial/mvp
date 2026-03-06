/**
 * Obsidian Bridge — Redis Pub/Sub -> Obsidian REST API bridge
 * Tests: constructor, frontmatter, throttling, event buffering,
 *        REST client, graceful degradation, system heartbeat
 * Usage: node --test test/obsidian-bridge.test.js
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ── Mocks ────────────────────────────────────────────────────────

/** Fake subscriber with pSubscribe/subscribe tracking */
function createMockSubscriber() {
  const subs = {};
  const psubs = {};
  return {
    subscribe: (channel, cb) => { subs[channel] = cb; },
    pSubscribe: (pattern, cb) => { psubs[pattern] = cb; },
    disconnect: async () => {},
    _subs: subs,
    _psubs: psubs,
  };
}

/** Fake Blackboard */
function createMockBlackboard() {
  const sub = createMockSubscriber();
  return {
    connect: async () => {},
    disconnect: async () => {},
    createSubscriber: async () => sub,
    client: { ping: async () => 'PONG' },
    _sub: sub,
  };
}

// ── Load module under test ───────────────────────────────────────

let ObsidianBridge;
let _generateAgentFrontmatter, _generateSystemFrontmatter;
let _generateEventEntry, _generateSkillsFrontmatter, _generateGoTFrontmatter;

// We load after mocks are set up
function loadModule() {
  // Clear cache to get fresh module with mocks
  delete require.cache[require.resolve('../agent/obsidian-bridge')];
  const mod = require('../agent/obsidian-bridge');
  ObsidianBridge = mod.ObsidianBridge;
  _generateAgentFrontmatter = mod._generateAgentFrontmatter;
  _generateSystemFrontmatter = mod._generateSystemFrontmatter;
  _generateEventEntry = mod._generateEventEntry;
  _generateSkillsFrontmatter = mod._generateSkillsFrontmatter;
  _generateGoTFrontmatter = mod._generateGoTFrontmatter;
  return mod;
}

// ── Constructor ──────────────────────────────────────────────────

describe('ObsidianBridge — Constructor', () => {
  beforeEach(() => loadModule());

  it('should use default API key from env', () => {
    const orig = process.env.OBSIDIAN_API_KEY;
    process.env.OBSIDIAN_API_KEY = 'test-key-123';
    const bridge = new ObsidianBridge();
    assert.equal(bridge.apiKey, 'test-key-123');
    if (orig !== undefined) process.env.OBSIDIAN_API_KEY = orig;
    else delete process.env.OBSIDIAN_API_KEY;
  });

  it('should accept apiKey in options', () => {
    const bridge = new ObsidianBridge({ apiKey: 'custom-key' });
    assert.equal(bridge.apiKey, 'custom-key');
  });

  it('should default port to 27124', () => {
    const bridge = new ObsidianBridge({ apiKey: 'k' });
    assert.equal(bridge.port, 27124);
  });

  it('should accept custom port', () => {
    const bridge = new ObsidianBridge({ apiKey: 'k', port: 9999 });
    assert.equal(bridge.port, 9999);
  });

  it('should default redisUrl to localhost:6380', () => {
    const bridge = new ObsidianBridge({ apiKey: 'k' });
    assert.equal(bridge.redisUrl, 'redis://localhost:6380');
  });

  it('should initialize empty state', () => {
    const bridge = new ObsidianBridge({ apiKey: 'k' });
    assert.equal(bridge._agentTimers.size, 0);
    assert.equal(bridge._eventBuffer.length, 0);
    assert.equal(bridge._running, false);
  });
});

// ── Frontmatter Generation ───────────────────────────────────────

describe('ObsidianBridge — Frontmatter Generation', () => {
  beforeEach(() => loadModule());

  it('should generate agent frontmatter YAML', () => {
    const md = _generateAgentFrontmatter('builder-01', {
      status: 'mining',
      health: 18,
      food: 16,
      position: { x: 10, y: 64, z: -30 },
    });
    assert.ok(md.includes('---'));
    assert.ok(md.includes('agent_id: builder-01'));
    assert.ok(md.includes('status: mining'));
    assert.ok(md.includes('health: 18'));
    assert.ok(md.includes('food: 16'));
  });

  it('should include position in agent frontmatter', () => {
    const md = _generateAgentFrontmatter('explorer-01', {
      status: 'scouting',
      position: { x: 100.5, y: 70.2, z: -50.9 },
    });
    assert.ok(md.includes('pos_x: 101'));
    assert.ok(md.includes('pos_y: 70'));
    assert.ok(md.includes('pos_z: -51'));
  });

  it('should handle missing fields gracefully', () => {
    const md = _generateAgentFrontmatter('leader', {});
    assert.ok(md.includes('agent_id: leader'));
    assert.ok(md.includes('status: unknown'));
  });

  it('should generate system frontmatter YAML', () => {
    const md = _generateSystemFrontmatter({
      redis: 'connected',
      agents_online: 5,
      uptime_seconds: 120,
    });
    assert.ok(md.includes('---'));
    assert.ok(md.includes('redis: connected'));
    assert.ok(md.includes('agents_online: 5'));
  });

  it('should generate skills frontmatter YAML', () => {
    const md = _generateSkillsFrontmatter([
      { name: 'mineWood', tier: 'Apprentice', xp: 30 },
      { name: 'buildShelter', tier: 'Journeyman', xp: 80 },
    ]);
    assert.ok(md.includes('---'));
    assert.ok(md.includes('skill_count: 2'));
    assert.ok(md.includes('mineWood'));
    assert.ok(md.includes('buildShelter'));
  });

  it('should generate GoT trace frontmatter YAML', () => {
    const md = _generateGoTFrontmatter({
      question: 'how to mine diamonds',
      answer: 'use iron pickaxe at y=11',
      synergies: 3,
      gaps: 1,
    });
    assert.ok(md.includes('---'));
    assert.ok(md.includes('synergies: 3'));
    assert.ok(md.includes('gaps: 1'));
  });
});

// ── Event Buffering ──────────────────────────────────────────────

describe('ObsidianBridge — Event Buffering', () => {
  let bridge;

  beforeEach(() => {
    loadModule();
    bridge = new ObsidianBridge({ apiKey: 'k' });
  });

  it('should buffer events', () => {
    bridge._appendEvent({ type: 'threat', agent: 'safety' });
    bridge._appendEvent({ type: 'chat', agent: 'leader' });
    assert.equal(bridge._eventBuffer.length, 2);
  });

  it('should trim buffer to max events', () => {
    const T = require('../config/timeouts');
    for (let i = 0; i < T.OBSIDIAN_MAX_EVENTS + 10; i++) {
      bridge._appendEvent({ type: 'test', index: i });
    }
    assert.equal(bridge._eventBuffer.length, T.OBSIDIAN_MAX_EVENTS);
  });

  it('should keep newest events when trimming', () => {
    const T = require('../config/timeouts');
    for (let i = 0; i < T.OBSIDIAN_MAX_EVENTS + 5; i++) {
      bridge._appendEvent({ type: 'test', index: i });
    }
    const last = bridge._eventBuffer[bridge._eventBuffer.length - 1];
    assert.equal(last.index, T.OBSIDIAN_MAX_EVENTS + 4);
  });

  it('should generate event entry markdown', () => {
    const entry = _generateEventEntry({
      type: 'threat',
      agent: 'safety',
      message: 'Zombie spotted',
      ts: 1709500000000,
    });
    assert.ok(entry.includes('threat'));
    assert.ok(entry.includes('safety'));
    assert.ok(entry.includes('Zombie spotted'));
  });

  it('should handle empty buffer flush gracefully', () => {
    assert.equal(bridge._eventBuffer.length, 0);
    // _flushEvents should not throw on empty buffer
    const md = bridge._buildEventsMarkdown();
    assert.ok(md.includes('---'));
  });
});

// ── Throttling ───────────────────────────────────────────────────

describe('ObsidianBridge — Throttling', () => {
  let bridge;

  beforeEach(() => {
    loadModule();
    bridge = new ObsidianBridge({ apiKey: 'k' });
    // Mock _obsidianPut to track calls
    bridge._putCalls = [];
    bridge._obsidianPut = async (path, content) => {
      bridge._putCalls.push({ path, content });
    };
  });

  afterEach(() => {
    bridge._clearTimers();
  });

  it('should debounce agent writes', async () => {
    bridge._throttledAgentWrite('builder-01', { status: 'mining', health: 20 });
    bridge._throttledAgentWrite('builder-01', { status: 'idle', health: 18 });

    // Should have a pending timer, not immediate writes
    assert.equal(bridge._putCalls.length, 0);
    assert.ok(bridge._agentTimers.has('builder-01'));
  });

  it('should track independent agents separately', () => {
    bridge._throttledAgentWrite('builder-01', { status: 'mining' });
    bridge._throttledAgentWrite('explorer-01', { status: 'scouting' });

    assert.ok(bridge._agentTimers.has('builder-01'));
    assert.ok(bridge._agentTimers.has('explorer-01'));
  });

  it('should merge agent data on debounce', () => {
    bridge._throttledAgentWrite('builder-01', { status: 'mining' });
    bridge._throttledAgentWrite('builder-01', { health: 18 });

    // Pending data should merge
    const pending = bridge._agentPending.get('builder-01');
    assert.equal(pending.status, 'mining');
    assert.equal(pending.health, 18);
  });

  it('should flush pending writes on stop', async () => {
    bridge._throttledAgentWrite('builder-01', { status: 'mining' });
    await bridge._flushPendingAgents();

    assert.equal(bridge._putCalls.length, 1);
    assert.ok(bridge._putCalls[0].path.includes('builder-01'));
  });
});

// ── REST API Client ──────────────────────────────────────────────

describe('ObsidianBridge — REST API Client', () => {
  beforeEach(() => loadModule());

  it('should build correct URL', () => {
    const bridge = new ObsidianBridge({ apiKey: 'k', port: 27124 });
    const url = bridge._buildUrl('vault/05-Live/system.md');
    assert.equal(url, 'https://127.0.0.1:27124/vault/05-Live/system.md');
  });

  it('should include auth header', () => {
    const bridge = new ObsidianBridge({ apiKey: 'my-secret-key' });
    const headers = bridge._buildHeaders();
    assert.equal(headers['Authorization'], 'Bearer my-secret-key');
    assert.equal(headers['Content-Type'], 'text/markdown');
  });

  it('should set timeout from config', () => {
    const bridge = new ObsidianBridge({ apiKey: 'k' });
    const T = require('../config/timeouts');
    assert.equal(bridge._apiTimeout, T.OBSIDIAN_API_TIMEOUT_MS);
  });
});

// ── Graceful Degradation ─────────────────────────────────────────

describe('ObsidianBridge — Graceful Degradation', () => {
  let bridge;

  beforeEach(() => {
    loadModule();
    bridge = new ObsidianBridge({ apiKey: 'k' });
  });

  it('should not throw when API is unreachable', async () => {
    // Use a port that nothing listens on
    bridge.port = 19999;
    // _obsidianPut should catch and log, not throw
    await assert.doesNotReject(
      bridge._obsidianPut('vault/05-Live/test.md', '# test')
    );
  });

  it('should track consecutive failures', async () => {
    bridge.port = 19999;
    await bridge._obsidianPut('vault/05-Live/test.md', '# test');
    assert.ok(bridge._consecutiveFailures >= 1);
  });

  it('should reset failure count on success', () => {
    bridge._consecutiveFailures = 5;
    bridge._onApiSuccess();
    assert.equal(bridge._consecutiveFailures, 0);
  });
});

// ── System Heartbeat ─────────────────────────────────────────────

describe('ObsidianBridge — System Heartbeat', () => {
  let bridge;

  beforeEach(() => {
    loadModule();
    bridge = new ObsidianBridge({ apiKey: 'k' });
    bridge._putCalls = [];
    bridge._obsidianPut = async (path, content) => {
      bridge._putCalls.push({ path, content });
    };
  });

  afterEach(() => {
    bridge._clearTimers();
  });

  it('should build heartbeat data', () => {
    const data = bridge._buildHeartbeatData();
    assert.ok('uptime_seconds' in data);
    assert.ok('bridge_status' in data);
    assert.equal(data.bridge_status, 'running');
  });

  it('should write system heartbeat', async () => {
    await bridge._writeSystemHeartbeat();
    assert.equal(bridge._putCalls.length, 1);
    assert.ok(bridge._putCalls[0].path.includes('system.md'));
  });

  it('should include Redis ping status when board connected', async () => {
    bridge.board = { client: { ping: async () => 'PONG' } };
    const data = bridge._buildHeartbeatData();
    assert.equal(data.bridge_status, 'running');
  });
});

// ── Subscription Wiring ─────────────────────────────────────────

describe('ObsidianBridge — Subscriptions', () => {
  let bridge;
  let mockBoard;

  beforeEach(async () => {
    loadModule();
    mockBoard = createMockBlackboard();
    bridge = new ObsidianBridge({ apiKey: 'k' });
    bridge.board = mockBoard;
    bridge.subscriber = await mockBoard.createSubscriber();
    // Mock write methods
    bridge._obsidianPut = async () => {};
    bridge._subscribeBlackboard();
  });

  afterEach(() => {
    bridge._clearTimers();
  });

  it('should subscribe to agent status pattern', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:agent:*:status' in sub._psubs);
  });

  it('should subscribe to agent health pattern', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:agent:*:health' in sub._psubs);
  });

  it('should subscribe to safety threat channel', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:safety:threat' in sub._subs);
  });

  it('should subscribe to leader reflexion channel', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:leader:reflexion' in sub._subs);
  });

  it('should subscribe to agent chat pattern', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:agent:*:chat' in sub._psubs);
  });

  it('should subscribe to agent confess pattern', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:agent:*:confess' in sub._psubs);
  });

  it('should subscribe to got reasoning complete', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:got:reasoning-complete' in sub._subs);
  });

  it('should subscribe to zettelkasten events', () => {
    const sub = mockBoard._sub;
    assert.ok('octiv:zettelkasten:*' in sub._psubs);
  });
});

// ── _extractAgentId ──────────────────────────────────────────────

describe('ObsidianBridge — _extractAgentId', () => {
  let _extractAgentId;

  beforeEach(() => {
    const mod = loadModule();
    _extractAgentId = mod._extractAgentId;
  });

  it('should extract agent id from full channel path', () => {
    const result = _extractAgentId('octiv:agent:builder-01:status');
    assert.equal(result, 'builder-01');
  });

  it('should return unknown for null or empty channel', () => {
    assert.equal(_extractAgentId(null), 'unknown');
    assert.equal(_extractAgentId(''), 'unknown');
  });

  it('should return unknown for channel without agent segment', () => {
    const result = _extractAgentId('octiv:system:health');
    assert.equal(result, 'unknown');
  });
});

// ── _onApiFailure logging ─────────────────────────────────────────

describe('ObsidianBridge — _onApiFailure logging', () => {
  let bridge;

  beforeEach(() => {
    loadModule();
    bridge = new ObsidianBridge({ apiKey: 'k' });
  });

  it('should increment consecutiveFailures on each call', () => {
    bridge._onApiFailure('test');
    bridge._onApiFailure('test');
    bridge._onApiFailure('test');
    assert.equal(bridge._consecutiveFailures, 3);
  });

  it('should continue incrementing beyond 3 without extra side effects', () => {
    // Failures 4-9 should silently increment
    for (let i = 0; i < 9; i++) {
      bridge._onApiFailure('test');
    }
    assert.equal(bridge._consecutiveFailures, 9);
  });

  it('should reach 10 consecutive failures', () => {
    for (let i = 0; i < 10; i++) {
      bridge._onApiFailure('test');
    }
    assert.equal(bridge._consecutiveFailures, 10);
  });
});

// ── Subscription handler fire-through ────────────────────────────

describe('ObsidianBridge — Subscription handler fire-through', () => {
  let bridge;
  let mockBoard;

  beforeEach(async () => {
    loadModule();
    mockBoard = createMockBlackboard();
    bridge = new ObsidianBridge({ apiKey: 'k' });
    bridge.board = mockBoard;
    bridge.subscriber = await mockBoard.createSubscriber();

    // Replace write methods with mocks
    bridge._throttledAgentWrite = mock.fn(() => {});
    bridge._appendEvent = mock.fn(() => {});
    bridge._writeGoTTrace = mock.fn(async () => {});
    bridge._writeSkillsSnapshot = mock.fn(async () => {});

    bridge._subscribeBlackboard();
  });

  afterEach(() => {
    bridge._clearTimers();
  });

  it('should call _throttledAgentWrite when agent status message fires', () => {
    const sub = mockBoard._sub;
    const handler = sub._psubs['octiv:agent:*:status'];
    handler(JSON.stringify({ agentId: 'builder-01', status: 'active', health: 20 }), 'octiv:agent:builder-01:status');
    assert.equal(bridge._throttledAgentWrite.mock.calls.length, 1);
  });

  it('should call _throttledAgentWrite when agent health message fires', () => {
    const sub = mockBoard._sub;
    const handler = sub._psubs['octiv:agent:*:health'];
    handler(JSON.stringify({ agentId: 'explorer-01', health: 15, food: 14 }), 'octiv:agent:explorer-01:health');
    assert.equal(bridge._throttledAgentWrite.mock.calls.length, 1);
  });

  it('should call _appendEvent when agent chat message fires', () => {
    const sub = mockBoard._sub;
    const handler = sub._psubs['octiv:agent:*:chat'];
    handler(JSON.stringify({ agentId: 'leader', message: 'hello team', ts: Date.now() }), 'octiv:agent:leader:chat');
    assert.equal(bridge._appendEvent.mock.calls.length, 1);
  });

  it('should call _appendEvent when agent confess message fires', () => {
    const sub = mockBoard._sub;
    const handler = sub._psubs['octiv:agent:*:confess'];
    handler(JSON.stringify({ agentId: 'builder-01', message: 'I got lost', ts: Date.now() }), 'octiv:agent:builder-01:confess');
    assert.equal(bridge._appendEvent.mock.calls.length, 1);
  });

  it('should call _appendEvent when safety threat message fires', () => {
    const sub = mockBoard._sub;
    const handler = sub._subs['octiv:safety:threat'];
    handler(JSON.stringify({ agentId: 'safety', threatType: 'zombie', ts: Date.now() }));
    assert.equal(bridge._appendEvent.mock.calls.length, 1);
  });

  it('should call _writeGoTTrace when got reasoning-complete fires', () => {
    const sub = mockBoard._sub;
    const handler = sub._subs['octiv:got:reasoning-complete'];
    handler(JSON.stringify({ question: 'how to mine', answer: 'use pickaxe', synergies: 2, gaps: 0 }));
    assert.equal(bridge._writeGoTTrace.mock.calls.length, 1);
  });
});

// ── _writeGoTTrace / _writeSkillsSnapshot ────────────────────────

describe('ObsidianBridge — _writeGoTTrace and _writeSkillsSnapshot', () => {
  let bridge;

  beforeEach(() => {
    loadModule();
    bridge = new ObsidianBridge({ apiKey: 'k' });
    bridge._putCalls = [];
    bridge._obsidianPut = async (path, content) => {
      bridge._putCalls.push({ path, content });
    };
  });

  it('should call _obsidianPut with got-traces.md path', async () => {
    await bridge._writeGoTTrace({ question: 'test?', answer: 'yes', synergies: 1, gaps: 0 });
    assert.equal(bridge._putCalls.length, 1);
    assert.ok(bridge._putCalls[0].path.includes('got-traces.md'));
  });

  it('should wrap single skill object into array for _writeSkillsSnapshot', async () => {
    await bridge._writeSkillsSnapshot({ name: 'mineWood', tier: 'Apprentice', xp: 10 });
    assert.equal(bridge._putCalls.length, 1);
    assert.ok(bridge._putCalls[0].content.includes('mineWood'));
  });

  it('should use skills array directly for _writeSkillsSnapshot when provided', async () => {
    await bridge._writeSkillsSnapshot({
      skills: [
        { name: 'mineWood', tier: 'Apprentice', xp: 10 },
        { name: 'buildShelter', tier: 'Journeyman', xp: 50 },
      ],
    });
    assert.equal(bridge._putCalls.length, 1);
    assert.ok(bridge._putCalls[0].content.includes('mineWood'));
    assert.ok(bridge._putCalls[0].content.includes('buildShelter'));
  });
});

// ── Start / Stop Lifecycle ───────────────────────────────────────

describe('ObsidianBridge — Lifecycle', () => {
  beforeEach(() => loadModule());

  it('should set _running to true on start (mock)', async () => {
    const bridge = new ObsidianBridge({ apiKey: 'k' });
    const mockBoard = createMockBlackboard();
    // Inject mock Blackboard constructor
    bridge._createBlackboard = () => mockBoard;
    bridge._obsidianPut = async () => {};
    await bridge.start();
    assert.equal(bridge._running, true);
    await bridge.stop();
  });

  it('should set _running to false on stop', async () => {
    const bridge = new ObsidianBridge({ apiKey: 'k' });
    const mockBoard = createMockBlackboard();
    bridge._createBlackboard = () => mockBoard;
    bridge._obsidianPut = async () => {};
    await bridge.start();
    await bridge.stop();
    assert.equal(bridge._running, false);
  });

  it('should flush pending on stop', async () => {
    const bridge = new ObsidianBridge({ apiKey: 'k' });
    const mockBoard = createMockBlackboard();
    bridge._createBlackboard = () => mockBoard;
    const putCalls = [];
    bridge._obsidianPut = async (p, c) => { putCalls.push({ p, c }); };
    await bridge.start();
    bridge._throttledAgentWrite('test-01', { status: 'active' });
    await bridge.stop();
    // Pending agent write should be flushed
    assert.ok(putCalls.length >= 1);
  });
});
