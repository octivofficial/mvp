/**
 * FarmerAgent Tests — Phase 7.2 Agent Expansion
 * TDD: Tests written FIRST, before implementation.
 * Usage: node --test --test-force-exit test/farmer-agent.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { FarmerAgent, CROP_TYPES, _setNav } = require('../agent/roles/FarmerAgent');

// ── Mock Helpers ────────────────────────────────────────────────────

// Inject mock nav module before any tests run
const mockNav = {
  setupPathfinder: mock.fn((bot, cached) => cached || { movements: true }),
  goto: mock.fn(async () => {}),
};
_setNav(mockNav);

function createMockBoard() {
  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    setHashField: mock.fn(async () => {}),
    deleteHashField: mock.fn(async () => {}),
    getConfig: mock.fn(async () => null),
  };
}

function createMockBot(overrides = {}) {
  const inventory = overrides.inventory || [];
  return {
    entity: { position: { x: 100, y: 64, z: 100 } },
    version: '1.21.11',
    findBlocks: mock.fn(() => overrides.findBlocks || []),
    blockAt: mock.fn((pos) => {
      if (overrides.blockAt) return overrides.blockAt(pos);
      return { name: 'grass_block', position: pos, metadata: 0 };
    }),
    dig: mock.fn(async () => {}),
    placeBlock: mock.fn(async () => {}),
    equip: mock.fn(async () => {}),
    activateBlock: mock.fn(async () => {}),
    inventory: {
      items: mock.fn(() => inventory),
    },
    pathfinder: {
      setMovements: mock.fn(() => {}),
      goto: mock.fn(async () => {}),
    },
    registry: {
      blocksByName: {
        farmland: { id: 60 },
        wheat: { id: 59 },
        carrots: { id: 141 },
        potatoes: { id: 142 },
        beetroots: { id: 207 },
      },
      itemsByName: {
        wheat_seeds: { id: 295 },
        carrot: { id: 391 },
        potato: { id: 392 },
        beetroot_seeds: { id: 458 },
        bone_meal: { id: 351 },
      },
    },
  };
}

function createAgent(overrides = {}) {
  const board = createMockBoard();
  const agent = new FarmerAgent({ id: 'farmer-01', ...overrides });
  agent.board = board;
  agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
  return { agent, board };
}

// ── Constructor ─────────────────────────────────────────────────────

describe('FarmerAgent — Constructor', () => {
  it('should extend BaseRole with role=farmer', () => {
    const { agent } = createAgent();
    assert.equal(agent.role, 'farmer');
    assert.equal(agent.id, 'farmer-01');
  });

  it('should use default id when not provided', () => {
    const agent = new FarmerAgent({});
    assert.equal(agent.id, 'agent-01');
    assert.equal(agent.role, 'farmer');
  });

  it('should initialize empty harvest inventory', () => {
    const { agent } = createAgent();
    const inv = agent.getInventory();
    assert.deepEqual(inv, {});
  });

  it('should accept configurable search radius', () => {
    const { agent } = createAgent({ searchRadius: 32 });
    assert.equal(agent.searchRadius, 32);
  });

  it('should use default search radius of 64', () => {
    const { agent } = createAgent();
    assert.equal(agent.searchRadius, 64);
  });
});

// ── CROP_TYPES ──────────────────────────────────────────────────────

describe('FarmerAgent — Crop Types', () => {
  it('should export CROP_TYPES constant', () => {
    assert.ok(Array.isArray(CROP_TYPES));
    assert.ok(CROP_TYPES.length > 0);
  });

  it('should include wheat, carrots, potatoes', () => {
    const names = CROP_TYPES.map(c => c.name);
    assert.ok(names.includes('wheat'));
    assert.ok(names.includes('carrots'));
    assert.ok(names.includes('potatoes'));
  });

  it('should have maxAge for each crop (harvest readiness)', () => {
    for (const crop of CROP_TYPES) {
      assert.ok(typeof crop.maxAge === 'number', `${crop.name} should have maxAge`);
      assert.ok(crop.maxAge > 0, `${crop.name} maxAge should be positive`);
    }
  });

  it('should have seed item for each crop', () => {
    for (const crop of CROP_TYPES) {
      assert.ok(typeof crop.seed === 'string', `${crop.name} should have seed`);
    }
  });
});

// ── execute() ───────────────────────────────────────────────────────

describe('FarmerAgent — execute()', () => {
  it('should harvest mature crops when found', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: (pos) => ({
        name: 'wheat', position: pos, metadata: 7, // mature wheat
      }),
    });

    const result = await agent.execute(bot);
    assert.equal(result.success, true);
    assert.ok(result.harvested > 0);
  });

  it('should return searching when no mature crops found', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({ findBlocks: [] });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'no_crops_found');
  });

  it('should publish farming event to Blackboard', async () => {
    const { agent, board } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    await agent.execute(bot);

    const farmCall = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:farmer-01:farming'
    );
    assert.ok(farmCall, 'should publish farming event');
    assert.equal(farmCall.arguments[1].author, 'farmer-01');
  });

  it('should report status changes during execution', async () => {
    const { agent, board } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    await agent.execute(bot);
    const statusCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'agent:farmer-01:status'
    );
    assert.ok(statusCalls.length >= 1, 'should publish status events');
  });

  it('should track harvested crops in inventory', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    await agent.execute(bot);
    const inv = agent.getInventory();
    assert.ok(inv.wheat >= 1, 'should have wheat in inventory');
  });

  it('should accumulate harvests across multiple executions', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    await agent.execute(bot);
    await agent.execute(bot);
    const inv = agent.getInventory();
    assert.ok(inv.wheat >= 2, 'should accumulate wheat');
  });
});

// ── findMatureCrops() ───────────────────────────────────────────────

describe('FarmerAgent — findMatureCrops()', () => {
  it('should return null when no crops found', () => {
    const { agent } = createAgent();
    const bot = createMockBot({ findBlocks: [] });
    const result = agent.findMatureCrops(bot);
    assert.equal(result, null);
  });

  it('should find mature wheat (metadata=7)', () => {
    const { agent } = createAgent();
    const cropPos = { x: 50, y: 64, z: 50 };
    const bot = createMockBot({
      findBlocks: [cropPos],
      blockAt: () => ({ name: 'wheat', position: cropPos, metadata: 7 }),
    });

    const result = agent.findMatureCrops(bot);
    assert.ok(result, 'should find mature crop');
    assert.deepEqual(result.position, cropPos);
  });

  it('should skip immature crops (metadata < maxAge)', () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 50, y: 64, z: 50 }],
      blockAt: () => ({ name: 'wheat', position: { x: 50, y: 64, z: 50 }, metadata: 2 }),
    });

    const result = agent.findMatureCrops(bot);
    assert.equal(result, null, 'should not return immature crop');
  });

  it('should search with configured radius', () => {
    const { agent } = createAgent({ searchRadius: 16 });
    const bot = createMockBot({ findBlocks: [] });
    agent.findMatureCrops(bot);

    const call = bot.findBlocks.mock.calls[0];
    assert.equal(call.arguments[0].maxDistance, 16);
  });
});

// ── replant() ───────────────────────────────────────────────────────

describe('FarmerAgent — replant()', () => {
  it('should replant after harvesting if seeds available', async () => {
    const { agent } = createAgent();
    const seeds = [{ name: 'wheat_seeds', type: 295 }];
    const bot = createMockBot({ inventory: seeds });
    const block = { name: 'farmland', position: { x: 50, y: 63, z: 50 } };

    const result = await agent.replant(bot, block, 'wheat');
    assert.equal(result, true);
  });

  it('should return false when no seeds available', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({ inventory: [] });
    const block = { name: 'farmland', position: { x: 50, y: 63, z: 50 } };

    const result = await agent.replant(bot, block, 'wheat');
    assert.equal(result, false);
  });
});

// ── Error Handling ──────────────────────────────────────────────────

describe('FarmerAgent — Error Handling', () => {
  it('should handle dig failure gracefully', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });
    bot.dig = mock.fn(async () => { throw new Error('Cannot harvest'); });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Cannot harvest'));
  });

  it('should handle null blockAt result', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => null,
    });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
  });

  it('should handle Blackboard publish failure without crashing', async () => {
    const { agent, board } = createAgent();
    board.publish = mock.fn(async () => { throw new Error('Redis down'); });

    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    await assert.doesNotReject(() => agent.execute(bot));
  });
});

// ── AgentChat Integration ───────────────────────────────────────────

describe('FarmerAgent — AgentChat', () => {
  it('should have chat instance', () => {
    const { agent } = createAgent();
    assert.ok(agent.chat, 'should have chat property');
  });

  it('should chat on harvest', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    await agent.execute(bot);
    assert.ok(agent.chat.chat.mock.callCount() >= 1, 'should chat about harvest');
  });

  it('should confess on milestone (every 10 harvests)', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    for (let i = 0; i < 10; i++) {
      await agent.execute(bot);
    }
    assert.ok(agent.chat.confess.mock.callCount() >= 1, 'should confess on milestone');
  });
});

// ── getInventory / getTotalHarvested ────────────────────────────────

describe('FarmerAgent — Inventory', () => {
  it('should return copy of inventory (not reference)', () => {
    const { agent } = createAgent();
    const inv1 = agent.getInventory();
    inv1.fake = 999;
    const inv2 = agent.getInventory();
    assert.equal(inv2.fake, undefined, 'should not leak mutations');
  });

  it('should count total harvested across all crop types', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    await agent.execute(bot);
    await agent.execute(bot);
    assert.equal(agent.getTotalHarvested(), 2);
  });

  it('should handle block_disappeared when blockAt returns null', async () => {
    const { agent } = createAgent();
    let callCount = 0;
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: (_pos) => {
        callCount++;
        // findMatureCrops calls blockAt, return a valid crop
        // execute() also calls blockAt for the same position — return null the second time
        if (callCount <= 1) return { name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 };
        return null;
      },
    });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'block_disappeared');
  });
});

// ── navigateToFarm() ────────────────────────────────────────────────

describe('FarmerAgent — navigateToFarm()', () => {
  it('should navigate to crop position successfully', async () => {
    const { agent } = createAgent();
    const bot = createMockBot();
    mockNav.goto.mock.resetCalls();
    mockNav.setupPathfinder.mock.resetCalls();

    const result = await agent.navigateToFarm(bot, { x: 50, y: 64, z: 50 });
    assert.equal(result.success, true);
  });

  it('should call setupPathfinder with cached movements', async () => {
    const { agent } = createAgent();
    const bot = createMockBot();
    mockNav.setupPathfinder.mock.resetCalls();

    await agent.navigateToFarm(bot, { x: 50, y: 64, z: 50 });
    assert.ok(mockNav.setupPathfinder.mock.callCount() >= 1, 'should call setupPathfinder');
  });

  it('should return nav_timeout on timeout error', async () => {
    const { agent } = createAgent();
    const bot = createMockBot();
    mockNav.goto.mock.mockImplementationOnce(async () => { throw new Error('timeout reached'); });

    const result = await agent.navigateToFarm(bot, { x: 50, y: 64, z: 50 });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_timeout');
  });

  it('should return nav_error on non-timeout error', async () => {
    const { agent } = createAgent();
    const bot = createMockBot();
    mockNav.goto.mock.mockImplementationOnce(async () => { throw new Error('path blocked'); });

    const result = await agent.navigateToFarm(bot, { x: 50, y: 64, z: 50 });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_error');
  });

  it('should emit chat event when navigating', async () => {
    const { agent } = createAgent();
    const bot = createMockBot();

    await agent.navigateToFarm(bot, { x: 50, y: 64, z: 50 });
    assert.ok(agent.chat.chat.mock.callCount() >= 1, 'should chat about navigation');
  });
});

// ── navigateToFarm goal functions ───────────────────────────────────

describe('FarmerAgent — navigateToFarm goal functions', () => {
  it('should consider isEnd true when within 2 blocks', async () => {
    const { agent } = createAgent();
    const bot = createMockBot();
    let capturedGoal;
    mockNav.goto.mock.mockImplementationOnce(async (b, goal) => { capturedGoal = goal; });

    await agent.navigateToFarm(bot, { x: 50, y: 64, z: 50 });
    assert.ok(capturedGoal, 'should capture goal');
    // within 2 blocks: distance squared <= 4
    assert.equal(capturedGoal.isEnd({ x: 51, y: 64, z: 50 }), true);
  });

  it('should consider isEnd false when far away', async () => {
    const { agent } = createAgent();
    const bot = createMockBot();
    let capturedGoal;
    mockNav.goto.mock.mockImplementationOnce(async (b, goal) => { capturedGoal = goal; });

    await agent.navigateToFarm(bot, { x: 50, y: 64, z: 50 });
    assert.ok(capturedGoal, 'should capture goal');
    // far away: distance squared > 4
    assert.equal(capturedGoal.isEnd({ x: 60, y: 64, z: 60 }), false);
  });
});

// ── execute() with navigation ───────────────────────────────────────

describe('FarmerAgent — execute() with navigation', () => {
  it('should navigate before digging', async () => {
    const { agent } = createAgent();
    const callOrder = [];
    mockNav.goto.mock.mockImplementationOnce(async () => { callOrder.push('nav'); });
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });
    bot.dig = mock.fn(async () => { callOrder.push('dig'); });

    await agent.execute(bot);
    assert.deepEqual(callOrder, ['nav', 'dig']);
  });

  it('should fail if navigation fails', async () => {
    const { agent } = createAgent();
    mockNav.goto.mock.mockImplementationOnce(async () => { throw new Error('no path'); });
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_error');
  });
});

// ── Inventory Management ────────────────────────────────────────────

describe('FarmerAgent — Inventory Management', () => {
  it('should report full when items >= threshold', () => {
    const { agent } = createAgent();
    const items = [{ name: 'wheat', count: 64 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.isInventoryFull(bot), true);
  });

  it('should report not full when items < threshold', () => {
    const { agent } = createAgent();
    const items = [{ name: 'wheat', count: 10 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.isInventoryFull(bot), false);
  });

  it('should report full when items exceed threshold', () => {
    const { agent } = createAgent();
    const items = [{ name: 'wheat', count: 100 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.isInventoryFull(bot), true);
  });

  it('should calculate remaining inventory space', () => {
    const { agent } = createAgent();
    const items = [{ name: 'wheat', count: 30 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.getInventorySpace(bot), 34); // 64 - 30
  });

  it('should count total items across all stacks', () => {
    const { agent } = createAgent();
    const items = [{ name: 'wheat', count: 20 }, { name: 'carrot', count: 15 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent._countItems(bot), 35);
  });

  it('should count zero when inventory is empty', () => {
    const { agent } = createAgent();
    const bot = createMockBot({ inventory: [] });
    assert.equal(agent._countItems(bot), 0);
  });
});

// ── executeSession() ────────────────────────────────────────────────

describe('FarmerAgent — executeSession()', () => {
  it('should harvest multiple crops in a session', async () => {
    const { agent } = createAgent();
    let harvestCount = 0;
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => {
        harvestCount++;
        if (harvestCount > 3) return null; // stop after 3 harvests
        return { name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 };
      },
    });

    const summary = await agent.executeSession(bot);
    assert.ok(summary.cropsHarvested >= 1, 'should harvest at least one crop');
    assert.ok(summary.duration >= 0, 'should track duration');
  });

  it('should stop when inventory is full', async () => {
    const { agent } = createAgent();
    const items = [{ name: 'wheat', count: 100 }]; // over threshold
    const bot = createMockBot({
      inventory: items,
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    const summary = await agent.executeSession(bot);
    assert.equal(summary.cropsHarvested, 0, 'should not harvest when full');
  });

  it('should stop when no crops found', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({ findBlocks: [] });

    const summary = await agent.executeSession(bot);
    assert.equal(summary.cropsHarvested, 0);
  });

  it('should return summary with inventory and duration', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });
    // Make execute fail after first to end session
    let count = 0;
    bot.blockAt = mock.fn((_pos) => {
      count++;
      if (count > 2) return null; // findMatureCrops + execute blockAt = 2 calls per cycle
      return { name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 };
    });

    const summary = await agent.executeSession(bot);
    assert.ok('inventory' in summary, 'should have inventory');
    assert.ok('duration' in summary, 'should have duration');
    assert.ok('cropsHarvested' in summary, 'should have cropsHarvested');
  });

  it('should call reportFarmingComplete after session', async () => {
    const { agent, board } = createAgent();
    const bot = createMockBot({ findBlocks: [] }); // immediate stop

    await agent.executeSession(bot);
    const completeCall = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:farmer-01:farming:complete'
    );
    assert.ok(completeCall, 'should publish farming complete event');
  });
});

// ── Blackboard Coordination ────────────────────────────────────────

describe('FarmerAgent — Blackboard Coordination', () => {
  it('should return hasQuota=true when no quota set', async () => {
    const { agent, board } = createAgent();
    board.getConfig = mock.fn(async () => null);

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });

  it('should return hasQuota=false when quota reached', async () => {
    const { agent, board } = createAgent();
    agent.totalHarvested = 50;
    board.getConfig = mock.fn(async () => ({ target: 50 }));

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, false);
  });

  it('should return hasQuota=true when under quota', async () => {
    const { agent, board } = createAgent();
    agent.totalHarvested = 10;
    board.getConfig = mock.fn(async () => ({ target: 50 }));

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
    assert.equal(result.target, 50);
    assert.equal(result.progress, 10);
  });

  it('should default hasQuota=true on Redis failure', async () => {
    const { agent, board } = createAgent();
    board.getConfig = mock.fn(async () => { throw new Error('Redis down'); });

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });

  it('should publish farming complete event', async () => {
    const { agent, board } = createAgent();
    const summary = { cropsHarvested: 5, inventory: { wheat: 5 }, duration: 10000 };

    await agent.reportFarmingComplete(summary);
    const call = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:farmer-01:farming:complete'
    );
    assert.ok(call, 'should publish to farming:complete channel');
    assert.equal(call.arguments[1].author, 'farmer-01');
    assert.equal(call.arguments[1].cropsHarvested, 5);
  });

  it('should handle Redis failure in reportFarmingComplete', async () => {
    const { agent, board } = createAgent();
    board.publish = mock.fn(async () => { throw new Error('Redis down'); });

    await assert.doesNotReject(() =>
      agent.reportFarmingComplete({ cropsHarvested: 5, inventory: {}, duration: 1000 })
    );
  });

  it('should stop session when quota reached', async () => {
    const { agent, board } = createAgent();
    agent.totalHarvested = 50;
    board.getConfig = mock.fn(async () => ({ target: 50 }));

    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 64, z: 100 }],
      blockAt: () => ({ name: 'wheat', position: { x: 105, y: 64, z: 100 }, metadata: 7 }),
    });

    const summary = await agent.executeSession(bot);
    assert.equal(summary.cropsHarvested, 0, 'should not harvest when quota reached');
  });

  it('should include timestamp in farming complete event', async () => {
    const { agent, board } = createAgent();
    const summary = { cropsHarvested: 3, inventory: { wheat: 3 }, duration: 5000 };

    await agent.reportFarmingComplete(summary);
    const call = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:farmer-01:farming:complete'
    );
    assert.ok(call.arguments[1].timestamp, 'should have timestamp');
  });
});
