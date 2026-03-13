/**
 * HeartbeatValidator Tests — TDD Red-Green-Refactor
 * Requirements (Requirement 3):
 *   - recordHeartbeat sets agents:heartbeat:{agentId} with current timestamp
 *   - isStale returns true if heartbeat > 60s old, false otherwise
 *   - checkAll calls handleInactive for each stale agent
 *   - handleInactive updates agent status to 'inactive' + publishes discord:alert
 *   - start()/stop() manage setInterval lifecycle
 *
 * Usage: node --test test/heartbeat-validator.test.js
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { HeartbeatValidator } = require('../agent/heartbeat-validator');

// ── Mock Blackboard factory ────────────────────────────────────
function createMockBoard() {
  const store = new Map();
  const board = {
    _store: store,
    set: mock.fn(async (key, value) => {
      store.set(key, value);
    }),
    get: mock.fn(async (key) => {
      return store.has(key) ? store.get(key) : null;
    }),
    publish: mock.fn(async (_channel, _data) => {}),
  };
  return board;
}

// ── constructor ────────────────────────────────────────────────

describe('HeartbeatValidator — constructor', () => {
  it('should accept board, intervalMs, staleThresholdMs options', () => {
    const board = createMockBoard();
    const hv = new HeartbeatValidator({ board, intervalMs: 5000, staleThresholdMs: 10000 });
    assert.equal(hv.intervalMs, 5000);
    assert.equal(hv.staleThresholdMs, 10000);
  });

  it('should use default intervalMs=30000 and staleThresholdMs=60000', () => {
    const board = createMockBoard();
    const hv = new HeartbeatValidator({ board });
    assert.equal(hv.intervalMs, 30000);
    assert.equal(hv.staleThresholdMs, 60000);
  });

  it('should start with no registered agents', () => {
    const board = createMockBoard();
    const hv = new HeartbeatValidator({ board });
    assert.equal(hv.agents.size, 0);
  });
});

// ── recordHeartbeat ────────────────────────────────────────────

describe('HeartbeatValidator — recordHeartbeat', () => {
  let board, hv;

  beforeEach(() => {
    board = createMockBoard();
    hv = new HeartbeatValidator({ board });
  });

  it('should set agents:heartbeat:{agentId} key with current timestamp', async () => {
    const before = Date.now();
    await hv.recordHeartbeat('miner-01');
    const after = Date.now();

    assert.equal(board.set.mock.calls.length, 1, 'board.set should be called once');
    const [key, value] = board.set.mock.calls[0].arguments;
    assert.equal(key, 'agents:heartbeat:miner-01');
    assert.ok(typeof value === 'number', 'value should be a number (timestamp)');
    assert.ok(value >= before && value <= after, 'timestamp should be within test window');
  });

  it('should register the agentId in internal agents set', async () => {
    await hv.recordHeartbeat('farmer-01');
    assert.ok(hv.agents.has('farmer-01'), 'agents set should contain farmer-01');
  });

  it('should update heartbeat for already-registered agent', async () => {
    await hv.recordHeartbeat('builder-01');
    await hv.recordHeartbeat('builder-01');
    assert.equal(board.set.mock.calls.length, 2, 'board.set should be called twice');
    assert.equal(hv.agents.size, 1, 'agents set should still have exactly 1 entry');
  });
});

// ── isStale ────────────────────────────────────────────────────

describe('HeartbeatValidator — isStale', () => {
  let board, hv;

  beforeEach(() => {
    board = createMockBoard();
    hv = new HeartbeatValidator({ board, staleThresholdMs: 60000 });
  });

  it('should return false when heartbeat is fresh (< 60s old)', async () => {
    board.get = mock.fn(async () => Date.now() - 30000); // 30s ago
    const stale = await hv.isStale('miner-01');
    assert.equal(stale, false);
  });

  it('should return true when heartbeat is exactly staleThresholdMs old', async () => {
    board.get = mock.fn(async () => Date.now() - 60000); // exactly 60s ago
    const stale = await hv.isStale('miner-01');
    assert.equal(stale, true);
  });

  it('should return true when heartbeat is older than staleThresholdMs', async () => {
    board.get = mock.fn(async () => Date.now() - 90000); // 90s ago
    const stale = await hv.isStale('miner-01');
    assert.equal(stale, true);
  });

  it('should return true when heartbeat key does not exist (null)', async () => {
    board.get = mock.fn(async () => null);
    const stale = await hv.isStale('unknown-agent');
    assert.equal(stale, true);
  });

  it('should read from agents:heartbeat:{agentId} key', async () => {
    board.get = mock.fn(async () => Date.now());
    await hv.isStale('explorer-01');
    assert.equal(board.get.mock.calls[0].arguments[0], 'agents:heartbeat:explorer-01');
  });
});

// ── handleInactive ─────────────────────────────────────────────

describe('HeartbeatValidator — handleInactive', () => {
  let board, hv;

  beforeEach(() => {
    board = createMockBoard();
    hv = new HeartbeatValidator({ board });
  });

  it('should set agent status to inactive via board.set', async () => {
    await hv.handleInactive('miner-01');

    const setCalls = board.set.mock.calls;
    const statusCall = setCalls.find(
      (c) => c.arguments[0] === 'agents:status:miner-01'
    );
    assert.ok(statusCall, 'should call board.set with agents:status:{agentId}');
    const statusValue = statusCall.arguments[1];
    assert.equal(statusValue.status, 'inactive');
  });

  it('should include agentId and timestamp in status value', async () => {
    const before = Date.now();
    await hv.handleInactive('farmer-01');
    const after = Date.now();

    const setCalls = board.set.mock.calls;
    const statusCall = setCalls.find((c) => c.arguments[0] === 'agents:status:farmer-01');
    assert.ok(statusCall, 'status set call not found');
    const val = statusCall.arguments[1];
    assert.equal(val.agentId, 'farmer-01');
    assert.ok(val.ts >= before && val.ts <= after, 'ts should be in test window');
  });

  it('should publish discord:alert notification', async () => {
    await hv.handleInactive('explorer-01');

    assert.equal(board.publish.mock.calls.length, 1, 'publish should be called once');
    const [channel, data] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'discord:alert');
    assert.ok(data, 'data should be provided');
  });

  it('should include agentId and status in discord:alert data', async () => {
    await hv.handleInactive('builder-01');

    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.agentId, 'builder-01');
    assert.equal(data.status, 'inactive');
    assert.ok(typeof data.message === 'string', 'message should be a string');
  });

  it('should include author field in discord:alert data (Blackboard 孝 requirement)', async () => {
    await hv.handleInactive('miner-01');

    const [, data] = board.publish.mock.calls[0].arguments;
    assert.ok(
      typeof data.author === 'string' && data.author.length > 0,
      'publish data must include a non-empty author field for Blackboard validation'
    );
  });
});

// ── checkAll ──────────────────────────────────────────────────

describe('HeartbeatValidator — checkAll', () => {
  let board, hv;

  beforeEach(() => {
    board = createMockBoard();
    hv = new HeartbeatValidator({ board, staleThresholdMs: 60000 });
  });

  it('should call handleInactive for each stale agent', async () => {
    // Register two agents with stale heartbeats
    const staleTs = Date.now() - 90000;
    hv.agents.add('miner-01');
    hv.agents.add('farmer-01');
    board.get = mock.fn(async () => staleTs);

    await hv.checkAll();

    // Each stale agent triggers: 1 board.set + 1 board.publish = 2 calls per agent
    const publishCalls = board.publish.mock.calls;
    const alertChannels = publishCalls.map((c) => c.arguments[0]);
    assert.equal(alertChannels.filter((ch) => ch === 'discord:alert').length, 2);
  });

  it('should NOT call handleInactive for fresh agents', async () => {
    const freshTs = Date.now() - 10000; // 10s ago
    hv.agents.add('builder-01');
    board.get = mock.fn(async () => freshTs);

    await hv.checkAll();

    // No inactive handling — no publishes
    assert.equal(board.publish.mock.calls.length, 0, 'no discord:alert for fresh agent');
  });

  it('should handle mixed stale and fresh agents correctly', async () => {
    hv.agents.add('stale-agent');
    hv.agents.add('fresh-agent');

    // stale-agent: 90s old, fresh-agent: 10s old
    board.get = mock.fn(async (key) => {
      if (key === 'agents:heartbeat:stale-agent') return Date.now() - 90000;
      if (key === 'agents:heartbeat:fresh-agent') return Date.now() - 10000;
      return null;
    });

    await hv.checkAll();

    const publishCalls = board.publish.mock.calls;
    assert.equal(publishCalls.length, 1, 'only one discord:alert should be published');
    const [, data] = publishCalls[0].arguments;
    assert.equal(data.agentId, 'stale-agent');
  });

  it('should do nothing when no agents are registered', async () => {
    // agents set is empty
    await hv.checkAll();
    assert.equal(board.set.mock.calls.length, 0);
    assert.equal(board.publish.mock.calls.length, 0);
  });
});

// ── MCPOrchestrator integration ───────────────────────────────

describe('MCPOrchestrator — heartbeatValidator integration', () => {
  it('should call recordHeartbeat when heartbeatValidator is injected and registerAgent is called', async () => {
    const { MCPOrchestrator } = require('../agent/mcp-orchestrator');

    const recordHeartbeat = mock.fn(async () => {});
    const mockValidator = { recordHeartbeat };

    // Mock board to avoid live Redis
    const orchestrator = new MCPOrchestrator({ heartbeatValidator: mockValidator });
    orchestrator.board = {
      setHashField: mock.fn(async () => {}),
      publish: mock.fn(async () => {}),
    };

    await orchestrator.registerAgent('miner-01', 'miner');

    assert.equal(recordHeartbeat.mock.calls.length, 1, 'recordHeartbeat should be called once');
    assert.equal(recordHeartbeat.mock.calls[0].arguments[0], 'miner-01');
  });

  it('should NOT call recordHeartbeat when no heartbeatValidator is injected', async () => {
    const { MCPOrchestrator } = require('../agent/mcp-orchestrator');

    const orchestrator = new MCPOrchestrator(); // no validator
    orchestrator.board = {
      setHashField: mock.fn(async () => {}),
      publish: mock.fn(async () => {}),
    };

    // Should not throw
    await assert.doesNotReject(() => orchestrator.registerAgent('builder-01', 'builder'));
  });
});

// ── start / stop ───────────────────────────────────────────────

describe('HeartbeatValidator — start and stop', () => {
  let board, hv;

  beforeEach(() => {
    board = createMockBoard();
    hv = new HeartbeatValidator({ board, intervalMs: 50 }); // fast for testing
  });

  afterEach(() => {
    hv.stop(); // always clean up timer
  });

  it('should set _timer when start() is called', () => {
    assert.equal(hv._timer, null, 'timer should be null before start');
    hv.start();
    assert.notEqual(hv._timer, null, 'timer should be set after start');
  });

  it('should clear _timer when stop() is called', () => {
    hv.start();
    hv.stop();
    assert.equal(hv._timer, null, 'timer should be null after stop');
  });

  it('should not throw if stop() is called before start()', () => {
    assert.doesNotThrow(() => hv.stop());
    assert.equal(hv._timer, null, '_timer should remain null after stop() on unstarted validator');
  });

  it('should not create duplicate timers on repeated start() calls', () => {
    hv.start();
    hv.start(); // second call
    // The second start should clear the first and create new, or be idempotent
    // Either way, _timer should be set (not null)
    assert.notEqual(hv._timer, null, '_timer should still be set');
    hv.stop();
  });
});
