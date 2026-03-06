/**
 * FarmerAgent Tests — Phase 7.2 Agent Expansion
 * TDD: Tests written FIRST, before implementation.
 * Usage: node --test --test-force-exit test/farmer-agent.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { FarmerAgent, CROP_TYPES } = require('../agent/roles/FarmerAgent');

// ── Mock Helpers ────────────────────────────────────────────────────

function createMockBoard() {
  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    setHashField: mock.fn(async () => {}),
    deleteHashField: mock.fn(async () => {}),
  };
}

function createMockBot(overrides = {}) {
  const inventory = overrides.inventory || [];
  return {
    entity: { position: { x: 100, y: 64, z: 100 } },
    version: '1.21.1',
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
      blockAt: (pos) => {
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
