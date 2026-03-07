/**
 * BaseRole Common Methods Tests — DRY Refactoring
 * Tests for extracted methods shared by MinerAgent and FarmerAgent.
 * Usage: node --test --test-force-exit test/base-role.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { BaseRole, _setNav } = require('../agent/roles/BaseRole');

// ── Mock Helpers ────────────────────────────────────────────────────

function createMockBoard(overrides = {}) {
  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    setHashField: mock.fn(async () => {}),
    deleteHashField: mock.fn(async () => {}),
    getConfig: mock.fn(async () => overrides.config || null),
  };
}

function createMockBot(overrides = {}) {
  const inventory = overrides.inventory || [];
  return {
    entity: { position: { x: 100, y: 64, z: 100 } },
    findBlocks: mock.fn(() => overrides.findBlocks || []),
    blockAt: mock.fn((pos) => {
      if (overrides.blockAt) return overrides.blockAt(pos);
      return { name: 'stone', position: pos };
    }),
    dig: mock.fn(async () => {}),
    equip: mock.fn(async () => {}),
    inventory: { items: mock.fn(() => inventory) },
    pathfinder: {
      setMovements: mock.fn(),
      goto: mock.fn(async () => {}),
    },
    registry: {
      blocksByName: { stone: { id: 1 } },
    },
  };
}

function createAgent(overrides = {}) {
  const board = createMockBoard(overrides.boardOverrides);
  const agent = new BaseRole({ id: 'test-01', role: 'tester', ...overrides });
  agent.board = board;
  return { agent, board };
}

// Inject mock navigation
const mockNav = {
  setupPathfinder: mock.fn((bot, cached) => cached || { movements: true }),
  goto: mock.fn(async () => {}),
};
_setNav(mockNav);

// ── _setNav ─────────────────────────────────────────────────────────

describe('BaseRole — _setNav', () => {
  it('should accept injected nav module', () => {
    _setNav(mockNav);
    // Verify nav is used by navigateTo (indirectly confirms injection)
    assert.equal(typeof _setNav, 'function');
  });
});

// ── _safeReport() ──────────────────────────────────────────────────

describe('BaseRole — _safeReport()', () => {
  it('should report status via Blackboard', async () => {
    const { agent, board } = createAgent();
    await agent._safeReport('working');
    const call = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:test-01:status'
    );
    assert.ok(call, 'should publish status');
  });

  it('should not throw on Redis failure', async () => {
    const { agent, board } = createAgent();
    board.publish = mock.fn(async () => { throw new Error('Redis down'); });
    await assert.doesNotReject(() => agent._safeReport('working'));
  });
});

// ── _countItems() ──────────────────────────────────────────────────

describe('BaseRole — _countItems()', () => {
  it('should sum item counts across all stacks', () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      inventory: [
        { name: 'coal', count: 5 },
        { name: 'iron', count: 3 },
        { name: 'gold', count: 2 },
      ],
    });
    assert.equal(agent._countItems(bot), 10);
  });

  it('should return 0 for empty inventory', () => {
    const { agent } = createAgent();
    const bot = createMockBot({ inventory: [] });
    assert.equal(agent._countItems(bot), 0);
  });

  it('should handle single item stack', () => {
    const { agent } = createAgent();
    const bot = createMockBot({ inventory: [{ name: 'diamond', count: 1 }] });
    assert.equal(agent._countItems(bot), 1);
  });
});

// ── isInventoryFull() ──────────────────────────────────────────────

describe('BaseRole — isInventoryFull()', () => {
  it('should return true when items >= threshold', () => {
    const { agent } = createAgent({ inventoryThreshold: 32 });
    const bot = createMockBot({ inventory: [{ name: 'coal', count: 32 }] });
    assert.equal(agent.isInventoryFull(bot), true);
  });

  it('should return false when items < threshold', () => {
    const { agent } = createAgent({ inventoryThreshold: 32 });
    const bot = createMockBot({ inventory: [{ name: 'coal', count: 10 }] });
    assert.equal(agent.isInventoryFull(bot), false);
  });

  it('should return true when items exceed threshold', () => {
    const { agent } = createAgent({ inventoryThreshold: 32 });
    const bot = createMockBot({
      inventory: [{ name: 'coal', count: 20 }, { name: 'iron', count: 15 }],
    });
    assert.equal(agent.isInventoryFull(bot), true);
  });
});

// ── getInventorySpace() ────────────────────────────────────────────

describe('BaseRole — getInventorySpace()', () => {
  it('should return remaining capacity', () => {
    const { agent } = createAgent({ inventoryThreshold: 64 });
    const bot = createMockBot({
      inventory: [{ name: 'wheat', count: 30 }],
    });
    assert.equal(agent.getInventorySpace(bot), 34);
  });

  it('should return zero when at threshold', () => {
    const { agent } = createAgent({ inventoryThreshold: 32 });
    const bot = createMockBot({ inventory: [{ name: 'coal', count: 32 }] });
    assert.equal(agent.getInventorySpace(bot), 0);
  });
});

// ── navigateTo() ──────────────────────────────────────────────────

describe('BaseRole — navigateTo()', () => {
  it('should navigate successfully', async () => {
    const { agent } = createAgent();
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    mockNav.goto.mock.resetCalls();

    const result = await agent.navigateTo(
      createMockBot(), { x: 50, y: 64, z: 50 }, 'resource', 15000
    );
    assert.equal(result.success, true);
  });

  it('should return nav_timeout on timeout error', async () => {
    const { agent } = createAgent();
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    mockNav.goto.mock.mockImplementationOnce(async () => {
      throw new Error('Pathfinding timeout after 15000ms');
    });

    const result = await agent.navigateTo(
      createMockBot(), { x: 50, y: 64, z: 50 }, 'resource', 15000
    );
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_timeout');
  });

  it('should return nav_error on non-timeout error', async () => {
    const { agent } = createAgent();
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    mockNav.goto.mock.mockImplementationOnce(async () => {
      throw new Error('No path found');
    });

    const result = await agent.navigateTo(
      createMockBot(), { x: 50, y: 64, z: 50 }, 'resource', 15000
    );
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_error');
  });

  it('should call setupPathfinder', async () => {
    const { agent } = createAgent();
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    mockNav.setupPathfinder.mock.resetCalls();

    await agent.navigateTo(
      createMockBot(), { x: 50, y: 64, z: 50 }, 'resource', 15000
    );
    assert.ok(mockNav.setupPathfinder.mock.callCount() >= 1);
  });

  it('should emit chat navigating event', async () => {
    const { agent } = createAgent();
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };

    await agent.navigateTo(
      createMockBot(), { x: 50, y: 64, z: 50 }, 'ore', 15000
    );
    const navCall = agent.chat.chat.mock.calls.find(
      c => c.arguments[0] === 'navigating'
    );
    assert.ok(navCall, 'should chat navigating');
    assert.equal(navCall.arguments[1].type, 'ore');
  });
});

// ── navigateTo goal ──────────────────────────────────────────────

describe('BaseRole — navigateTo goal', () => {
  it('isEnd should return true within 2 blocks', async () => {
    const { agent } = createAgent();
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    let capturedGoal;
    mockNav.goto.mock.mockImplementationOnce(async (b, goal) => {
      capturedGoal = goal;
    });

    await agent.navigateTo(
      createMockBot(), { x: 10, y: 60, z: 10 }, 'test', 15000
    );
    assert.ok(capturedGoal);
    assert.equal(capturedGoal.isEnd({ x: 10, y: 60, z: 10 }), true);
    assert.equal(capturedGoal.isEnd({ x: 11, y: 60, z: 10 }), true);
  });

  it('isEnd should return false when far away', async () => {
    const { agent } = createAgent();
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    let capturedGoal;
    mockNav.goto.mock.mockImplementationOnce(async (b, goal) => {
      capturedGoal = goal;
    });

    await agent.navigateTo(
      createMockBot(), { x: 10, y: 60, z: 10 }, 'test', 15000
    );
    assert.equal(capturedGoal.isEnd({ x: 100, y: 60, z: 100 }), false);
    assert.equal(capturedGoal.hasChanged(), false);
  });
});

// ── checkQuota() ──────────────────────────────────────────────────

describe('BaseRole — checkQuota()', () => {
  it('should return hasQuota=true when no quotaKey set', async () => {
    const { agent } = createAgent();
    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });

  it('should return hasQuota=true when no quota configured', async () => {
    const { agent } = createAgent({ quotaKey: 'test:quota' });
    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });

  it('should return hasQuota=false when target reached', async () => {
    const board = createMockBoard({ config: { target: 5 } });
    const agent = new BaseRole({
      id: 'test-01', role: 'tester', quotaKey: 'test:quota',
    });
    agent.board = board;
    agent.totalCount = 5;

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, false);
    assert.equal(result.target, 5);
    assert.equal(result.progress, 5);
  });

  it('should return hasQuota=true when under target', async () => {
    const board = createMockBoard({ config: { target: 10 } });
    const agent = new BaseRole({
      id: 'test-01', role: 'tester', quotaKey: 'test:quota',
    });
    agent.board = board;
    agent.totalCount = 3;

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });

  it('should default hasQuota=true on Redis failure', async () => {
    const board = createMockBoard();
    board.getConfig = mock.fn(async () => { throw new Error('Redis down'); });
    const agent = new BaseRole({
      id: 'test-01', role: 'tester', quotaKey: 'test:quota',
    });
    agent.board = board;

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });
});

// ── reportActivityComplete() ───────────────────────────────────────

describe('BaseRole — reportActivityComplete()', () => {
  it('should publish summary to activity complete channel', async () => {
    const { agent, board } = createAgent({ activityName: 'mining' });
    const summary = { oresMined: 5, duration: 60000 };

    await agent.reportActivityComplete(summary);
    const call = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:test-01:mining:complete'
    );
    assert.ok(call, 'should publish to activity:complete channel');
    assert.equal(call.arguments[1].author, 'test-01');
    assert.equal(call.arguments[1].oresMined, 5);
  });

  it('should not throw on Redis failure', async () => {
    const { agent, board } = createAgent({ activityName: 'mining' });
    board.publish = mock.fn(async () => { throw new Error('Redis down'); });

    await assert.doesNotReject(() =>
      agent.reportActivityComplete({ count: 0 })
    );
  });

  it('should include timestamp', async () => {
    const { agent, board } = createAgent({ activityName: 'farming' });
    await agent.reportActivityComplete({ count: 3 });

    const call = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:test-01:farming:complete'
    );
    assert.ok(call.arguments[1].timestamp, 'should have timestamp');
  });
});

// ── executeSession() ──────────────────────────────────────────────

describe('BaseRole — executeSession()', () => {
  it('should loop execute() and count actions', async () => {
    const { agent } = createAgent({
      inventoryThreshold: 100, sessionTimeoutMs: 120000,
    });
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    let count = 0;
    agent.execute = async () => {
      count++;
      if (count > 3) return { success: false, reason: 'done' };
      return { success: true };
    };
    agent.getInventory = () => ({});

    const bot = createMockBot({ inventory: [] });
    const result = await agent.executeSession(bot);
    assert.equal(result.actionCount, 3);
    assert.ok(result.duration >= 0);
  });

  it('should stop when inventory full', async () => {
    const { agent } = createAgent({
      inventoryThreshold: 32, sessionTimeoutMs: 120000,
    });
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    agent.getInventory = () => ({});

    const bot = createMockBot({ inventory: [{ name: 'stuff', count: 50 }] });
    const result = await agent.executeSession(bot);
    assert.equal(result.actionCount, 0);
  });

  it('should stop when execute returns failure', async () => {
    const { agent } = createAgent({
      inventoryThreshold: 100, sessionTimeoutMs: 120000,
    });
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    agent.execute = async () => ({ success: false, reason: 'nothing' });
    agent.getInventory = () => ({});

    const bot = createMockBot({ inventory: [] });
    const result = await agent.executeSession(bot);
    assert.equal(result.actionCount, 0);
  });

  it('should stop when quota reached', async () => {
    const board = createMockBoard({ config: { target: 0 } });
    const agent = new BaseRole({
      id: 'test-01', role: 'tester',
      quotaKey: 'test:quota', inventoryThreshold: 100, sessionTimeoutMs: 120000,
    });
    agent.board = board;
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    agent.getInventory = () => ({});

    const bot = createMockBot({ inventory: [] });
    const result = await agent.executeSession(bot);
    assert.equal(result.actionCount, 0);
  });

  it('should call _buildSessionSummary and reportActivityComplete', async () => {
    const { agent, board } = createAgent({
      inventoryThreshold: 100, sessionTimeoutMs: 120000,
      activityName: 'testing',
    });
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    agent.execute = async () => ({ success: false });
    agent.getInventory = () => ({ item: 1 });

    const bot = createMockBot({ inventory: [] });
    await agent.executeSession(bot);

    const call = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:test-01:testing:complete'
    );
    assert.ok(call, 'should report activity complete');
  });
});
