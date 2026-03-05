/**
 * MinerAgent Tests — Phase 7.2 Agent Expansion
 * TDD: Tests written FIRST, before implementation.
 * Usage: node --test --test-force-exit test/miner-agent.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

// Will be implemented in agent/roles/MinerAgent.js
const { MinerAgent, ORE_PRIORITY } = require('../agent/roles/MinerAgent');

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
    entity: { position: { x: 100, y: 20, z: 100 } },
    version: '1.21.1',
    findBlocks: mock.fn(() => overrides.findBlocks || []),
    blockAt: mock.fn((pos) => {
      if (overrides.blockAt) return overrides.blockAt(pos);
      return { name: 'stone', position: pos };
    }),
    dig: mock.fn(async () => {}),
    equip: mock.fn(async () => {}),
    canDigBlock: mock.fn(() => overrides.canDig !== false),
    inventory: {
      items: mock.fn(() => inventory),
    },
    pathfinder: {
      setMovements: mock.fn(),
      goto: mock.fn(async () => {}),
    },
    registry: {
      blocksByName: {
        coal_ore: { id: 16 },
        deepslate_coal_ore: { id: 17 },
        iron_ore: { id: 15 },
        deepslate_iron_ore: { id: 18 },
        gold_ore: { id: 14 },
        deepslate_gold_ore: { id: 19 },
        diamond_ore: { id: 56 },
        deepslate_diamond_ore: { id: 57 },
        copper_ore: { id: 20 },
        deepslate_copper_ore: { id: 21 },
        lapis_ore: { id: 22 },
        deepslate_lapis_ore: { id: 23 },
        redstone_ore: { id: 73 },
        deepslate_redstone_ore: { id: 74 },
        stone: { id: 1 },
      },
    },
  };
}

// Helper: create agent with mock board injected
function createAgent(overrides = {}) {
  const board = createMockBoard();
  const agent = new MinerAgent({ id: 'miner-01', ...overrides });
  agent.board = board;  // Replace real Blackboard with mock
  agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
  return { agent, board };
}

// ── Constructor ─────────────────────────────────────────────────────

describe('MinerAgent — Constructor', () => {
  it('should extend BaseRole with role=miner', () => {
    const { agent } = createAgent();
    assert.equal(agent.role, 'miner');
    assert.equal(agent.id, 'miner-01');
  });

  it('should use default id when not provided', () => {
    const agent = new MinerAgent({});
    assert.equal(agent.id, 'agent-01');
    assert.equal(agent.role, 'miner');
  });

  it('should initialize empty mined inventory', () => {
    const { agent } = createAgent();
    const inv = agent.getInventory();
    assert.deepEqual(inv, {});
  });

  it('should accept configurable search radius', () => {
    const { agent } = createAgent({ searchRadius: 128 });
    assert.equal(agent.searchRadius, 128);
  });

  it('should use default search radius of 64', () => {
    const { agent } = createAgent();
    assert.equal(agent.searchRadius, 64);
  });
});

// ── ORE_PRIORITY ────────────────────────────────────────────────────

describe('MinerAgent — Ore Priority', () => {
  it('should export ORE_PRIORITY constant', () => {
    assert.ok(Array.isArray(ORE_PRIORITY));
    assert.ok(ORE_PRIORITY.length > 0);
  });

  it('should prioritize diamond highest, coal lowest', () => {
    const diamondIdx = ORE_PRIORITY.indexOf('diamond');
    const coalIdx = ORE_PRIORITY.indexOf('coal');
    assert.ok(diamondIdx < coalIdx, 'diamond should be before coal in priority');
  });

  it('should include iron and gold', () => {
    assert.ok(ORE_PRIORITY.includes('iron'));
    assert.ok(ORE_PRIORITY.includes('gold'));
  });
});

// ── execute() ───────────────────────────────────────────────────────

describe('MinerAgent — execute()', () => {
  it('should return success when ore is found and mined', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    const result = await agent.execute(bot);
    assert.equal(result.success, true);
    assert.ok(result.mined > 0);
  });

  it('should return failure when no ore nearby', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({ findBlocks: [] });
    const result = await agent.execute(bot);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'no_ore_found');
  });

  it('should publish mining event to Blackboard', async () => {
    const { agent, board } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'iron_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    await agent.execute(bot);
    assert.ok(board.publish.mock.callCount() >= 1);

    const miningCall = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:miner-01:mining'
    );
    assert.ok(miningCall, 'should publish mining event');
    assert.equal(miningCall.arguments[1].author, 'miner-01');
  });

  it('should report status changes during execution', async () => {
    const { agent, board } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    await agent.execute(bot);
    const statusCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'agent:miner-01:status'
    );
    assert.ok(statusCalls.length >= 1, 'should publish status events');
  });

  it('should track mined ores in inventory', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    await agent.execute(bot);
    const inv = agent.getInventory();
    assert.ok(inv.coal >= 1, 'should have coal in inventory');
  });

  it('should accumulate ores across multiple executions', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'iron_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    await agent.execute(bot);
    await agent.execute(bot);
    const inv = agent.getInventory();
    assert.ok(inv.iron >= 2, 'should have accumulated iron');
  });
});

// ── findOre() ───────────────────────────────────────────────────────

describe('MinerAgent — findOre()', () => {
  it('should search for ores using bot.findBlocks', () => {
    const { agent } = createAgent();
    const bot = createMockBot({ findBlocks: [] });
    const result = agent.findOre(bot);
    assert.equal(result, null);
    assert.ok(bot.findBlocks.mock.callCount() >= 1);
  });

  it('should return position when ore is found', () => {
    const { agent } = createAgent();
    const orePos = { x: 50, y: 12, z: 50 };
    const bot = createMockBot({ findBlocks: [orePos] });
    const result = agent.findOre(bot);
    assert.deepEqual(result, orePos);
  });

  it('should search with configured radius', () => {
    const { agent } = createAgent({ searchRadius: 32 });
    const bot = createMockBot({ findBlocks: [] });
    agent.findOre(bot);

    const call = bot.findBlocks.mock.calls[0];
    assert.equal(call.arguments[0].maxDistance, 32);
  });
});

// ── equipBestPickaxe() ──────────────────────────────────────────────

describe('MinerAgent — equipBestPickaxe()', () => {
  it('should equip diamond pickaxe over wooden', async () => {
    const { agent } = createAgent();
    const items = [
      { name: 'wooden_pickaxe', type: 1 },
      { name: 'diamond_pickaxe', type: 2 },
    ];
    const bot = createMockBot({ inventory: items });

    await agent.equipBestPickaxe(bot);
    assert.equal(bot.equip.mock.callCount(), 1);
    const equipped = bot.equip.mock.calls[0].arguments[0];
    assert.equal(equipped.name, 'diamond_pickaxe');
  });

  it('should equip iron pickaxe over stone', async () => {
    const { agent } = createAgent();
    const items = [
      { name: 'stone_pickaxe', type: 1 },
      { name: 'iron_pickaxe', type: 2 },
    ];
    const bot = createMockBot({ inventory: items });

    await agent.equipBestPickaxe(bot);
    const equipped = bot.equip.mock.calls[0].arguments[0];
    assert.equal(equipped.name, 'iron_pickaxe');
  });

  it('should return false when no pickaxe available', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({ inventory: [{ name: 'dirt', type: 1 }] });
    const result = await agent.equipBestPickaxe(bot);
    assert.equal(result, false);
    assert.equal(bot.equip.mock.callCount(), 0);
  });

  it('should equip any pickaxe if only one available', async () => {
    const { agent } = createAgent();
    const items = [{ name: 'wooden_pickaxe', type: 1 }];
    const bot = createMockBot({ inventory: items });

    const result = await agent.equipBestPickaxe(bot);
    assert.equal(result, true);
    assert.equal(bot.equip.mock.calls[0].arguments[0].name, 'wooden_pickaxe');
  });
});

// ── Error Handling ──────────────────────────────────────────────────

describe('MinerAgent — Error Handling', () => {
  it('should handle dig failure gracefully', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'iron_ore', position: { x: 105, y: 18, z: 100 } }),
    });
    bot.dig = mock.fn(async () => { throw new Error('Cannot dig'); });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Cannot dig'));
  });

  it('should handle undiggable blocks', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'iron_ore', position: { x: 105, y: 18, z: 100 } }),
      canDig: false,
    });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
  });

  it('should handle null blockAt result', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => null,
    });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
  });

  it('should handle Blackboard publish failure without crashing', async () => {
    const { agent, board } = createAgent();
    // Make ALL publish calls fail (including reportStatus)
    board.publish = mock.fn(async () => { throw new Error('Redis down'); });

    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    // Should not throw — mining still succeeds even if publish fails
    await assert.doesNotReject(() => agent.execute(bot));
  });
});

// ── AgentChat Integration ───────────────────────────────────────────

describe('MinerAgent — AgentChat', () => {
  it('should have chat instance', () => {
    const { agent } = createAgent();
    assert.ok(agent.chat, 'should have chat property');
  });

  it('should chat on ore discovery', async () => {
    const { agent } = createAgent();

    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'diamond_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    await agent.execute(bot);
    assert.ok(agent.chat.chat.mock.callCount() >= 1, 'should chat about mining');
  });

  it('should confess on milestone (every 10 ores)', async () => {
    const { agent } = createAgent();

    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    for (let i = 0; i < 10; i++) {
      await agent.execute(bot);
    }

    assert.ok(agent.chat.confess.mock.callCount() >= 1, 'should confess on milestone');
  });
});

// ── getInventory / getTotalMined ────────────────────────────────────

describe('MinerAgent — Inventory', () => {
  it('should return copy of inventory (not reference)', () => {
    const { agent } = createAgent();
    const inv1 = agent.getInventory();
    inv1.fake = 999;
    const inv2 = agent.getInventory();
    assert.equal(inv2.fake, undefined, 'should not leak mutations');
  });

  it('should count total mined across all ore types', async () => {
    const { agent } = createAgent();

    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });

    await agent.execute(bot);
    await agent.execute(bot);
    assert.equal(agent.getTotalMined(), 2);
  });
});
