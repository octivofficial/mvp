/**
 * A2A Mission Communication Tests
 * Tests builder's ability to receive and execute Leader-assigned missions
 * via Redis pub/sub instead of hardcoded AC progression.
 *
 * Usage: node --test --test-force-exit test/a2a-mission.test.js
 */
const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { Vec3 } = require('vec3');

// ── Mock helpers ──────────────────────────────────────────────────────

function createMockBlackboard() {
  const subscribers = [];
  const board = {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    get: mock.fn(async () => null),
    updateAC: mock.fn(async () => {}),
    getACProgress: mock.fn(async () => ({})),
    logReflexion: mock.fn(async () => {}),
    createSubscriber: mock.fn(async () => {
      const sub = {
        subscribe: mock.fn(async () => {}),
        unsubscribe: mock.fn(async () => {}),
        disconnect: mock.fn(async () => {}),
        _handlers: {},
      };
      // Store handler for testing — simulates Redis pub/sub
      const origSubscribe = sub.subscribe;
      sub.subscribe = mock.fn(async (channel, handler) => {
        sub._handlers[channel] = handler;
      });
      subscribers.push(sub);
      return sub;
    }),
    _subscribers: subscribers,
  };
  return board;
}

function createMockBot(overrides = {}) {
  const bot = new EventEmitter();
  bot.username = overrides.username || 'OctivBot_builder-test';
  bot.health = 20;
  bot.food = 20;
  bot.entity = {
    position: new Vec3(100, 64, -200),
    velocity: { x: 0, y: 0, z: 0 },
  };
  bot.chat = mock.fn();
  bot.end = mock.fn();
  bot.quit = mock.fn();
  bot.loadPlugin = mock.fn();
  bot.waitForTicks = mock.fn(async () => {});
  bot.dig = mock.fn(async () => {});
  bot.equip = mock.fn(async () => {});
  bot.craft = mock.fn(async () => {});
  bot.placeBlock = mock.fn(async () => {});
  bot.blockAt = mock.fn(() => ({ position: new Vec3(0, 0, 0), name: 'dirt', boundingBox: 'block' }));
  bot.findBlock = mock.fn(() => null);
  bot.findBlocks = mock.fn(() => []);
  bot.inventory = { items: mock.fn(() => []) };
  bot.version = '1.21.11';
  bot.registry = { itemsByName: {} };
  bot.pathfinder = {
    setMovements: mock.fn(),
    goto: mock.fn(async () => {}),
    stop: mock.fn(),
  };
  bot.collectBlock = { collect: mock.fn(async () => {}) };
  return bot;
}

// ═══════════════════════════════════════════════════════════════════
// 1. Mission Subscription Setup
// ═══════════════════════════════════════════════════════════════════

describe('A2A Mission — Subscription Setup', () => {
  const { BuilderAgent } = require('../agent/builder');

  it('should subscribe to mission channel on init', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent.board = board;
    agent.bot = createMockBot();

    await agent._setupMissionSubscriber();

    assert.equal(board.createSubscriber.mock.calls.length, 1, 'should create subscriber');
    const sub = board._subscribers[0];
    assert.equal(sub.subscribe.mock.calls.length, 1, 'should subscribe to mission channel');
    assert.equal(sub.subscribe.mock.calls[0].arguments[0], 'octiv:command:builder-01:mission');
  });

  it('should store received mission', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-02' });
    agent.board = board;
    agent.bot = createMockBot();

    await agent._setupMissionSubscriber();

    // Simulate leader publishing a mission
    const sub = board._subscribers[0];
    const handler = sub._handlers['octiv:command:builder-02:mission'];
    assert.ok(handler, 'handler should be registered');

    const missionPayload = JSON.stringify({
      ts: Date.now(),
      author: 'leader',
      ac: 1,
      action: 'collectWood',
      params: { count: 16 },
    });
    handler(missionPayload);

    assert.ok(agent._lastMission, 'should store mission');
    assert.equal(agent._lastMission.action, 'collectWood');
    assert.equal(agent._lastMission.ac, 1);
    assert.deepEqual(agent._lastMission.params, { count: 16 });
  });

  it('should handle malformed mission gracefully', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-03' });
    agent.board = board;
    agent.bot = createMockBot();

    await agent._setupMissionSubscriber();

    const sub = board._subscribers[0];
    const handler = sub._handlers['octiv:command:builder-03:mission'];

    // Should not throw
    handler('not-json');
    assert.equal(agent._lastMission, null, 'should not store invalid mission');
  });

  it('should update mission when leader sends new one', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent.board = board;
    agent.bot = createMockBot();

    await agent._setupMissionSubscriber();

    const sub = board._subscribers[0];
    const handler = sub._handlers['octiv:command:builder-01:mission'];

    // First mission: collectWood
    handler(JSON.stringify({ author: 'leader', ac: 1, action: 'collectWood', params: { count: 16 } }));
    assert.equal(agent._lastMission.action, 'collectWood');

    // Second mission: craftBasicTools
    handler(JSON.stringify({ author: 'leader', ac: 3, action: 'craftBasicTools', params: {} }));
    assert.equal(agent._lastMission.action, 'craftBasicTools');
    assert.equal(agent._lastMission.ac, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Mission-Driven Execution
// ═══════════════════════════════════════════════════════════════════

describe('A2A Mission — _getMissionAction', () => {
  const { BuilderAgent } = require('../agent/builder');

  it('should return leader mission action when available', () => {
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent._lastMission = { ac: 1, action: 'collectWood', params: { count: 16 } };

    const action = agent._getMissionAction();
    assert.equal(action, 'collectWood');
  });

  it('should fallback to local AC tracking when no mission', () => {
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent._lastMission = null;
    agent.acProgress = { 1: false, 2: false, 3: false, 4: false, 5: false };

    const action = agent._getMissionAction();
    assert.equal(action, 'collectWood', 'should default to first uncompleted AC');
  });

  it('should skip completed ACs in fallback mode', () => {
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent._lastMission = null;
    agent.acProgress = { 1: true, 2: false, 3: false, 4: false, 5: false };

    const action = agent._getMissionAction();
    assert.equal(action, 'craftBasicTools', 'AC-1 done → AC-3 next');
  });

  it('should return idle when leader says idle', () => {
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent._lastMission = { ac: 0, action: 'idle', params: {} };

    const action = agent._getMissionAction();
    assert.equal(action, 'idle');
  });

  it('should return idle when all ACs complete and no mission', () => {
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent._lastMission = null;
    agent.acProgress = { 1: true, 2: true, 3: true, 4: true, 5: true };

    const action = agent._getMissionAction();
    assert.equal(action, 'idle');
  });

  it('should return leader mission params', () => {
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent._lastMission = { ac: 1, action: 'collectWood', params: { count: 32 } };

    const params = agent._getMissionParams();
    assert.deepEqual(params, { count: 32 });
  });

  it('should return empty params when no mission', () => {
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent._lastMission = null;

    const params = agent._getMissionParams();
    assert.deepEqual(params, {});
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Shutdown Cleanup
// ═══════════════════════════════════════════════════════════════════

describe('A2A Mission — Shutdown', () => {
  const { BuilderAgent } = require('../agent/builder');

  it('should unsubscribe and disconnect mission subscriber on shutdown', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent.board = board;
    agent.bot = createMockBot();

    await agent._setupMissionSubscriber();
    const sub = board._subscribers[0];

    await agent.shutdown();

    assert.equal(sub.unsubscribe.mock.calls.length, 1, 'should unsubscribe');
    assert.equal(sub.disconnect.mock.calls.length, 1, 'should disconnect subscriber');
  });

  it('should handle shutdown without mission subscriber', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent.board = board;
    agent.bot = createMockBot();

    // No _setupMissionSubscriber called
    await assert.doesNotReject(() => agent.shutdown());
  });

  it('should handle subscriber cleanup errors gracefully', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent.board = board;
    agent.bot = createMockBot();

    await agent._setupMissionSubscriber();
    const sub = board._subscribers[0];
    sub.unsubscribe = mock.fn(async () => { throw new Error('already unsubscribed'); });
    sub.disconnect = mock.fn(async () => { throw new Error('already disconnected'); });

    await assert.doesNotReject(() => agent.shutdown());
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Mission Acknowledgment
// ═══════════════════════════════════════════════════════════════════

describe('A2A Mission — Acknowledgment', () => {
  const { BuilderAgent } = require('../agent/builder');

  it('should publish mission acknowledgment when receiving mission', async () => {
    const board = createMockBlackboard();
    const agent = new BuilderAgent({ id: 'builder-01' });
    agent.board = board;
    agent.bot = createMockBot();

    await agent._setupMissionSubscriber();

    const sub = board._subscribers[0];
    const handler = sub._handlers['octiv:command:builder-01:mission'];

    handler(JSON.stringify({
      author: 'leader',
      ac: 1,
      action: 'collectWood',
      params: { count: 16 },
    }));

    // Builder should acknowledge receipt
    const publishCalls = board.publish.mock.calls;
    const ackCall = publishCalls.find(c =>
      c.arguments[0] === `agent:builder-01:mission:ack`
    );
    assert.ok(ackCall, 'should publish mission acknowledgment');
    assert.equal(ackCall.arguments[1].action, 'collectWood');
  });
});
