/**
 * MinerAgent Tests — Phase 7.2 Agent Expansion
 * TDD: Tests written FIRST, before implementation.
 * Usage: node --test --test-force-exit test/miner-agent.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { MinerAgent, ORE_PRIORITY, SMELT_RECIPES, _setNav } = require('../agent/roles/MinerAgent');
const T = require('../config/timeouts');

// Inject mock navigation module to avoid loading heavy mineflayer-pathfinder
_setNav({
  setupPathfinder: (bot, cached) => {
    const movements = cached || {};
    bot.pathfinder.setMovements(movements);
    return movements;
  },
  goto: (bot, goal, _timeout) => bot.pathfinder.goto(goal),
});

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
    openFurnace: mock.fn(async () => ({
      putInput: mock.fn(async () => {}),
      close: mock.fn(async () => {}),
    })),
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
        furnace: { id: 61 },
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

// ── navigateToOre() ────────────────────────────────────────────────

describe('MinerAgent — navigateToOre()', () => {
  it('should navigate successfully and return success', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      blockAt: () => ({ name: 'iron_ore', position: { x: 50, y: 12, z: 50 } }),
    });

    const result = await agent.navigateToOre(bot, { x: 50, y: 12, z: 50 });
    assert.equal(result.success, true);
  });

  it('should call setupPathfinder and goto', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      blockAt: () => ({ name: 'iron_ore', position: { x: 50, y: 12, z: 50 } }),
    });

    await agent.navigateToOre(bot, { x: 50, y: 12, z: 50 });
    assert.ok(bot.pathfinder.setMovements.mock.callCount() >= 1, 'should setup pathfinder');
    assert.ok(bot.pathfinder.goto.mock.callCount() >= 1, 'should call goto');
  });

  it('should return nav_timeout on pathfinder timeout', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      blockAt: () => ({ name: 'iron_ore', position: { x: 50, y: 12, z: 50 } }),
    });
    bot.pathfinder.goto = mock.fn(async () => { throw new Error('Pathfinding timeout after 15000ms'); });

    const result = await agent.navigateToOre(bot, { x: 50, y: 12, z: 50 });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_timeout');
  });

  it('should return nav_error on pathfinder error', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      blockAt: () => ({ name: 'iron_ore', position: { x: 50, y: 12, z: 50 } }),
    });
    bot.pathfinder.goto = mock.fn(async () => { throw new Error('No path found'); });

    const result = await agent.navigateToOre(bot, { x: 50, y: 12, z: 50 });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_error');
  });

  it('should chat navigating event before moving', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      blockAt: () => ({ name: 'diamond_ore', position: { x: 50, y: 12, z: 50 } }),
    });

    await agent.navigateToOre(bot, { x: 50, y: 12, z: 50 });
    const navCall = agent.chat.chat.mock.calls.find(c => c.arguments[0] === 'navigating');
    assert.ok(navCall, 'should chat navigating event');
  });

  it('should cache pathfinder movements', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      blockAt: () => ({ name: 'iron_ore', position: { x: 50, y: 12, z: 50 } }),
    });

    await agent.navigateToOre(bot, { x: 50, y: 12, z: 50 });
    assert.ok(agent._cachedMovements !== null, 'should cache movements');
  });
});

// ── execute() with navigation ──────────────────────────────────────

describe('MinerAgent — execute() with navigation', () => {
  it('should navigate before digging', async () => {
    const { agent } = createAgent();
    const callOrder = [];
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });
    bot.pathfinder.goto = mock.fn(async () => { callOrder.push('goto'); });
    bot.dig = mock.fn(async () => { callOrder.push('dig'); });

    await agent.execute(bot);
    assert.deepEqual(callOrder, ['goto', 'dig'], 'should goto before dig');
  });

  it('should fail if navigation fails', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
    });
    bot.pathfinder.goto = mock.fn(async () => { throw new Error('No path'); });

    const result = await agent.execute(bot);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'nav_error');
    assert.equal(bot.dig.mock.callCount(), 0, 'should not dig if nav fails');
  });
});

// ── Inventory Management ──────────────────────────────────────────

describe('MinerAgent — Inventory Management', () => {
  it('isInventoryFull returns true when >= threshold', () => {
    const { agent } = createAgent();
    const items = [{ name: 'coal', count: 32 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.isInventoryFull(bot), true);
  });

  it('isInventoryFull returns false when < threshold', () => {
    const { agent } = createAgent();
    const items = [{ name: 'coal', count: 10 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.isInventoryFull(bot), false);
  });

  it('isInventoryFull returns true when exceeds threshold', () => {
    const { agent } = createAgent();
    const items = [{ name: 'coal', count: 20 }, { name: 'iron', count: 15 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.isInventoryFull(bot), true);
  });

  it('getInventorySpace returns correct remaining', () => {
    const { agent } = createAgent();
    const items = [{ name: 'coal', count: 10 }, { name: 'iron', count: 5 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent.getInventorySpace(bot), T.MINING_INVENTORY_THRESHOLD - 15);
  });

  it('_countItems sums across stacks', () => {
    const { agent } = createAgent();
    const items = [{ name: 'coal', count: 5 }, { name: 'iron', count: 3 }, { name: 'gold', count: 2 }];
    const bot = createMockBot({ inventory: items });
    assert.equal(agent._countItems(bot), 10);
  });

  it('_countItems returns 0 for empty inventory', () => {
    const { agent } = createAgent();
    const bot = createMockBot({ inventory: [] });
    assert.equal(agent._countItems(bot), 0);
  });
});

// ── executeSession() ──────────────────────────────────────────────

describe('MinerAgent — executeSession()', () => {
  it('should mine multiple ores in a session', async () => {
    const { agent } = createAgent();
    let mineCount = 0;
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
      inventory: [],
    });

    // Limit to 3 ores then stop
    agent.execute = async (_b) => {
      mineCount++;
      if (mineCount > 3) return { success: false, reason: 'no_ore_found' };
      // Simulate mining
      agent.mined.coal = (agent.mined.coal || 0) + 1;
      agent.totalMined++;
      return { success: true, ore: 'coal', mined: agent.totalMined };
    };

    const result = await agent.executeSession(bot);
    assert.equal(result.oresMined, 3);
    assert.ok(result.duration >= 0);
  });

  it('should stop on inventory full', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
      inventory: [{ name: 'coal', count: 32 }],
    });

    const result = await agent.executeSession(bot);
    assert.equal(result.oresMined, 0, 'should not mine when inventory full');
  });

  it('should stop when no ore found', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({
      findBlocks: [],
      inventory: [],
    });

    const result = await agent.executeSession(bot);
    assert.equal(result.oresMined, 0);
  });

  it('should return correct summary', async () => {
    const { agent } = createAgent();
    agent.execute = async () => {
      agent.mined.iron = (agent.mined.iron || 0) + 1;
      agent.totalMined++;
      if (agent.totalMined >= 2) return { success: false, reason: 'no_ore_found' };
      return { success: true, ore: 'iron', mined: agent.totalMined };
    };
    const bot = createMockBot({ inventory: [] });

    const result = await agent.executeSession(bot);
    assert.equal(result.oresMined, 1);
    assert.ok(result.inventory.iron >= 1);
    assert.ok(result.duration >= 0);
  });

  it('should report mining complete via Blackboard', async () => {
    const { agent, board } = createAgent();
    agent.execute = async () => ({ success: false, reason: 'no_ore_found' });
    const bot = createMockBot({ inventory: [] });

    await agent.executeSession(bot);
    const completeCall = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:miner-01:mining:complete'
    );
    assert.ok(completeCall, 'should publish mining:complete event');
  });
});

// ── Smelting ──────────────────────────────────────────────────────

describe('MinerAgent — Smelting', () => {
  it('canSmelt returns true for raw_iron', () => {
    const { agent } = createAgent();
    assert.equal(agent.canSmelt('raw_iron'), true);
  });

  it('canSmelt returns true for raw_gold', () => {
    const { agent } = createAgent();
    assert.equal(agent.canSmelt('raw_gold'), true);
  });

  it('canSmelt returns true for raw_copper', () => {
    const { agent } = createAgent();
    assert.equal(agent.canSmelt('raw_copper'), true);
  });

  it('canSmelt returns false for coal_ore', () => {
    const { agent } = createAgent();
    assert.equal(agent.canSmelt('coal_ore'), false);
  });

  it('canSmelt returns false for diamond_ore', () => {
    const { agent } = createAgent();
    assert.equal(agent.canSmelt('diamond_ore'), false);
  });

  it('canSmelt returns false for stone', () => {
    const { agent } = createAgent();
    assert.equal(agent.canSmelt('stone'), false);
  });

  it('SMELT_RECIPES maps raw ores to ingots', () => {
    assert.equal(SMELT_RECIPES.raw_iron, 'iron_ingot');
    assert.equal(SMELT_RECIPES.raw_gold, 'gold_ingot');
    assert.equal(SMELT_RECIPES.raw_copper, 'copper_ingot');
  });

  it('findFurnace returns position when furnace exists', async () => {
    const { agent } = createAgent();
    const furnacePos = { x: 10, y: 64, z: 10 };
    const bot = createMockBot({ findBlocks: [furnacePos] });

    const result = await agent.findFurnace(bot);
    assert.deepEqual(result, furnacePos);
  });

  it('findFurnace returns null when no furnace', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({ findBlocks: [] });

    const result = await agent.findFurnace(bot);
    assert.equal(result, null);
  });

  it('findFurnace returns null when furnace not in registry', async () => {
    const { agent } = createAgent();
    const bot = createMockBot({});
    delete bot.registry.blocksByName.furnace;

    const result = await agent.findFurnace(bot);
    assert.equal(result, null);
  });

  it('smelt navigates to furnace, deposits, and closes', async () => {
    const { agent } = createAgent();
    const furnacePos = { x: 10, y: 64, z: 10 };
    const mockFurnace = {
      putInput: mock.fn(async () => {}),
      close: mock.fn(async () => {}),
    };
    const bot = createMockBot({
      inventory: [
        { name: 'raw_iron', type: 100, count: 5 },
        { name: 'coal', type: 101, count: 10 },
      ],
      blockAt: () => ({ name: 'furnace', position: furnacePos }),
    });
    bot.openFurnace = mock.fn(async () => mockFurnace);

    await agent.smelt(bot, furnacePos);
    assert.equal(bot.openFurnace.mock.callCount(), 1, 'should open furnace');
    assert.equal(mockFurnace.putInput.mock.callCount(), 1, 'should deposit smeltable items only');
    assert.equal(mockFurnace.close.mock.callCount(), 1, 'should close furnace');
  });

  it('smelt handles empty smeltable inventory', async () => {
    const { agent } = createAgent();
    const furnacePos = { x: 10, y: 64, z: 10 };
    const mockFurnace = {
      putInput: mock.fn(async () => {}),
      close: mock.fn(async () => {}),
    };
    const bot = createMockBot({
      inventory: [{ name: 'coal', type: 101, count: 10 }],
      blockAt: () => ({ name: 'furnace', position: furnacePos }),
    });
    bot.openFurnace = mock.fn(async () => mockFurnace);

    await agent.smelt(bot, furnacePos);
    assert.equal(mockFurnace.putInput.mock.callCount(), 0, 'no smeltable items');
    assert.equal(mockFurnace.close.mock.callCount(), 1, 'should still close');
  });
});

// ── Blackboard Coordination ──────────────────────────────────────

describe('MinerAgent — Blackboard Coordination', () => {
  it('checkQuota returns hasQuota=true when no quota set', async () => {
    const { agent } = createAgent();
    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });

  it('checkQuota returns hasQuota=false when target reached', async () => {
    const board = createMockBoard({ config: { target: 5 } });
    const agent = new MinerAgent({ id: 'miner-01' });
    agent.board = board;
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    agent.totalMined = 5;

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, false);
    assert.equal(result.target, 5);
    assert.equal(result.progress, 5);
  });

  it('checkQuota returns hasQuota=true when under target', async () => {
    const board = createMockBoard({ config: { target: 10 } });
    const agent = new MinerAgent({ id: 'miner-01' });
    agent.board = board;
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
    agent.totalMined = 3;

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true);
  });

  it('checkQuota handles Redis failure gracefully', async () => {
    const { agent, board } = createAgent();
    board.getConfig = mock.fn(async () => { throw new Error('Redis down'); });

    const result = await agent.checkQuota();
    assert.equal(result.hasQuota, true, 'should default to hasQuota on failure');
  });

  it('reportMiningComplete publishes summary to Blackboard', async () => {
    const { agent, board } = createAgent();
    const summary = { oresMined: 5, inventory: { coal: 3, iron: 2 }, duration: 60000 };

    await agent.reportMiningComplete(summary);
    const call = board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:miner-01:mining:complete'
    );
    assert.ok(call, 'should publish mining:complete');
    assert.equal(call.arguments[1].author, 'miner-01');
    assert.equal(call.arguments[1].oresMined, 5);
  });

  it('reportMiningComplete handles Redis failure', async () => {
    const { agent, board } = createAgent();
    board.publish = mock.fn(async () => { throw new Error('Redis down'); });

    await assert.doesNotReject(() =>
      agent.reportMiningComplete({ oresMined: 0, inventory: {}, duration: 0 })
    );
  });

  it('executeSession stops when quota reached', async () => {
    const board = createMockBoard({ config: { target: 0 } });
    const agent = new MinerAgent({ id: 'miner-01' });
    agent.board = board;
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };

    const bot = createMockBot({
      findBlocks: [{ x: 105, y: 18, z: 100 }],
      blockAt: () => ({ name: 'coal_ore', position: { x: 105, y: 18, z: 100 } }),
      inventory: [],
    });

    const result = await agent.executeSession(bot);
    assert.equal(result.oresMined, 0, 'should not mine when quota reached');
  });

  it('executeSession checks quota before each cycle', async () => {
    let quotaCalls = 0;
    const board = createMockBoard();
    board.getConfig = mock.fn(async () => {
      quotaCalls++;
      if (quotaCalls >= 3) return { target: 0 }; // Stop on 3rd check
      return null;
    });
    const agent = new MinerAgent({ id: 'miner-01' });
    agent.board = board;
    agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };

    agent.execute = async () => {
      agent.totalMined++;
      return { success: true, ore: 'coal', mined: agent.totalMined };
    };
    const bot = createMockBot({ inventory: [] });

    await agent.executeSession(bot);
    assert.ok(quotaCalls >= 2, 'should check quota multiple times');
  });
});
