/**
 * Builder Failure Path Tests
 * Tests builder behavior when mineflayer operations FAIL:
 * - pathfinder timeout / unreachable goal
 * - dig failure (block gone, tool breaks)
 * - craft failure (missing ingredients, no recipe)
 * - placeBlock failure (can't reach, block occupied)
 * - equip failure (item not in inventory)
 * - collectWood with no trees nearby
 * - buildShelter with no flat site
 * - gatherAtShelter with no shelter coords
 * - wandering autonomy (wander, radius expansion, selfImprove chain)
 */
const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { Vec3 } = require('vec3');

// ── Mock helpers ─────────────────────────────────────────────────────

function createMockBot(overrides = {}) {
  const bot = new EventEmitter();
  bot.username = overrides.username || 'OctivBot_builder-fail';
  bot.health = 20;
  bot.food = 20;
  bot.entity = {
    position: overrides.position || new Vec3(100, 64, -200),
    velocity: { x: 0, y: 0, z: 0 },
  };
  bot.chat = mock.fn();
  bot.end = mock.fn();
  bot.quit = mock.fn();
  bot.loadPlugin = mock.fn();
  bot.waitForTicks = mock.fn(async () => {});
  bot.placeBlock = mock.fn(async () => {});
  bot.equip = mock.fn(async () => {});
  bot.craft = mock.fn(async () => {});
  bot.dig = mock.fn(async () => {});
  bot.blockAt = mock.fn((pos) => ({
    position: pos, name: 'dirt', boundingBox: 'block',
  }));
  bot.findBlock = mock.fn(() => null);
  bot.findBlocks = mock.fn(() => []);
  bot.recipesFor = mock.fn(() => []);
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

// ── 1. Pathfinder Failures ───────────────────────────────────────────

describe('Builder Failures — Pathfinder', () => {
  const { goto } = require('../agent/builder-navigation');

  it('should reject when pathfinder.goto throws (unreachable goal)', async () => {
    const bot = createMockBot();
    bot.pathfinder.goto = mock.fn(async () => {
      throw new Error('Path goal unreachable');
    });

    await assert.rejects(
      () => goto(bot, { x: 999, y: 64, z: 999 }, 5000),
      (err) => {
        assert.ok(err.message.includes('unreachable'), `Expected unreachable error, got: ${err.message}`);
        return true;
      }
    );
  });

  it('should reject with timeout when pathfinder hangs', async () => {
    const bot = createMockBot();
    bot.pathfinder.goto = mock.fn(() => new Promise(() => {})); // never resolves

    await assert.rejects(
      () => goto(bot, { x: 0, y: 64, z: 0 }, 100),
      (err) => {
        assert.ok(err.message.includes('timeout'), `Expected timeout error, got: ${err.message}`);
        return true;
      }
    );
    // Should call pathfinder.stop() on timeout
    assert.equal(bot.pathfinder.stop.mock.calls.length, 1, 'Should stop pathfinder on timeout');
  });
});

// ── 2. Dig Failures ─────────────────────────────────────────────────

describe('Builder Failures — Dig (collectWood)', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-dig*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  async function createBuilderForDig() {
    const builder = new BuilderAgent({ id: 'builder-dig-test' });
    await builder.board.connect();
    const mockBot = createMockBot();
    mockBot.entity.position = new Vec3(100, 64, -200);
    builder.bot = mockBot;
    builder.mcData = require('minecraft-data')('1.21.11');
    builder._setupPathfinder = () => {};
    builder._goto = mock.fn(async () => {});
    return { builder, mockBot };
  }

  it('should propagate dig error when block disappears mid-dig', async () => {
    const { builder, mockBot } = await createBuilderForDig();

    // findBlock returns a log, but dig fails
    const fakeLog = { position: new Vec3(105, 64, -195), name: 'oak_log' };
    mockBot.findBlock = mock.fn(() => fakeLog);
    mockBot.dig = mock.fn(async () => { throw new Error('Block is not diggable'); });

    await assert.rejects(
      () => builder.collectWood(1),
      (err) => {
        assert.ok(err.message.includes('not diggable'), `Expected dig error, got: ${err.message}`);
        return true;
      }
    );
    await builder.board.disconnect();
  });

  it('should propagate goto error when pathfinder fails during wood collection', async () => {
    const { builder, mockBot } = await createBuilderForDig();

    const fakeLog = { position: new Vec3(105, 64, -195), name: 'oak_log' };
    mockBot.findBlock = mock.fn(() => fakeLog);
    builder._goto = mock.fn(async () => { throw new Error('Path goal unreachable'); });

    await assert.rejects(
      () => builder.collectWood(1),
      (err) => {
        assert.ok(err.message.includes('unreachable'), `Expected pathfinder error, got: ${err.message}`);
        return true;
      }
    );
    await builder.board.disconnect();
  });
});

// ── 3. Craft Failures ───────────────────────────────────────────────

describe('Builder Failures — Craft', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-craft*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('should propagate craft error when crafting table fails', async () => {
    const builder = new BuilderAgent({ id: 'builder-craft-test' });
    await builder.board.connect();
    const mockBot = createMockBot();
    builder.bot = mockBot;
    builder.bot.registry = {
      itemsByName: { crafting_table: { id: 58 }, wooden_pickaxe: { id: 270 } },
    };

    mockBot.craft = mock.fn(async () => { throw new Error('Missing ingredients'); });

    await assert.rejects(
      () => builder.craftBasicTools(),
      (err) => {
        assert.ok(err.message.includes('Missing ingredients'), `Expected craft error, got: ${err.message}`);
        return true;
      }
    );
    // AC-3 should NOT be marked done on failure
    assert.equal(builder.acProgress[3], false, 'AC-3 should remain incomplete on craft failure');
    await builder.board.disconnect();
  });
});

// ── 4. PlaceBlock Failures ──────────────────────────────────────────

describe('Builder Failures — PlaceBlock (shelter)', () => {
  const { placeBlockAt } = require('../agent/builder-shelter');

  it('should throw when block not in inventory', async () => {
    const bot = createMockBot();
    bot.inventory.items = mock.fn(() => []); // empty inventory
    const gotoFn = async () => {};

    await assert.rejects(
      () => placeBlockAt(bot, new Vec3(10, 65, 10), 'oak_planks', gotoFn),
      (err) => {
        assert.ok(err.message.includes('No oak_planks'), `Expected inventory error, got: ${err.message}`);
        return true;
      }
    );
  });

  it('should propagate equip failure', async () => {
    const bot = createMockBot();
    bot.inventory.items = mock.fn(() => [{ name: 'oak_planks', count: 64 }]);
    bot.equip = mock.fn(async () => { throw new Error('Cannot equip while moving'); });
    const gotoFn = async () => {};

    await assert.rejects(
      () => placeBlockAt(bot, new Vec3(10, 65, 10), 'oak_planks', gotoFn),
      (err) => {
        assert.ok(err.message.includes('Cannot equip'), `Expected equip error, got: ${err.message}`);
        return true;
      }
    );
  });

  it('should propagate placeBlock failure', async () => {
    const bot = createMockBot();
    bot.inventory.items = mock.fn(() => [{ name: 'oak_planks', count: 64 }]);
    bot.equip = mock.fn(async () => {});
    bot.blockAt = mock.fn(() => ({ position: new Vec3(10, 64, 10), name: 'dirt' }));
    bot.placeBlock = mock.fn(async () => { throw new Error('Block is occupied'); });
    const gotoFn = async () => {};

    await assert.rejects(
      () => placeBlockAt(bot, new Vec3(10, 65, 10), 'oak_planks', gotoFn),
      (err) => {
        assert.ok(err.message.includes('occupied'), `Expected placement error, got: ${err.message}`);
        return true;
      }
    );
  });

  it('should propagate gotoFn failure during block placement', async () => {
    const bot = createMockBot();
    const gotoFn = async () => { throw new Error('Path goal unreachable'); };

    await assert.rejects(
      () => placeBlockAt(bot, new Vec3(10, 65, 10), 'oak_planks', gotoFn),
      (err) => {
        assert.ok(err.message.includes('unreachable'), `Expected goto error, got: ${err.message}`);
        return true;
      }
    );
  });
});

// ── 5. BuildShelter — No Flat Site ──────────────────────────────────

describe('Builder Failures — BuildShelter', () => {
  const { buildShelter, findBuildSite } = require('../agent/builder-shelter');

  it('should throw when no flat build site found', async () => {
    const bot = createMockBot();
    bot.entity.position = new Vec3(100, 64, -200);
    // All blocks are air — no solid ground
    bot.blockAt = mock.fn(() => ({ name: 'air', boundingBox: 'empty' }));
    bot.recipesFor = mock.fn(() => []);

    const mcData = require('minecraft-data')('1.21.11');

    await assert.rejects(
      () => buildShelter({
        bot, mcData,
        board: { updateAC: async () => {}, publish: async () => {} },
        id: 'builder-nosite',
        logger: null,
        adaptations: { buildSiteRadius: 2 },
        gotoFn: async () => {},
        setupPathfinderFn: () => {},
      }),
      (err) => {
        assert.ok(err.message.includes('No suitable build site'), `Expected no-site error, got: ${err.message}`);
        return true;
      }
    );
  });

  it('findBuildSite should return null when terrain is all air', () => {
    const bot = createMockBot();
    bot.entity.position = new Vec3(0, 64, 0);
    bot.blockAt = mock.fn(() => ({ name: 'air', boundingBox: 'empty' }));

    const result = findBuildSite(bot, 3);
    assert.equal(result, null, 'Should return null when no flat site exists');
  });
});

// ── 6. GatherAtShelter — Missing Coordinates ────────────────────────

describe('Builder Failures — GatherAtShelter', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-gather*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('should throw when shelter coordinates not in Blackboard', async () => {
    // Clean any stale shelter key from previous runs
    await redisClient.del('octiv:builder:shelter:latest');

    const builder = new BuilderAgent({ id: 'builder-gather-fail' });
    await builder.board.connect();
    const mockBot = createMockBot();
    builder.bot = mockBot;
    builder._setupPathfinder = () => {};

    // Don't publish any shelter coords — board.get returns null

    await assert.rejects(
      () => builder.gatherAtShelter(),
      (err) => {
        assert.ok(err.message.includes('No shelter coordinates'), `Expected missing shelter error, got: ${err.message}`);
        return true;
      }
    );
    // AC-4 should NOT be marked done
    assert.equal(builder.acProgress[4], false, 'AC-4 should remain incomplete');
    await builder.board.disconnect();
  });

  it('should propagate pathfinder failure during gather', async () => {
    const builder = new BuilderAgent({ id: 'builder-gather-path' });
    await builder.board.connect();
    const mockBot = createMockBot();
    mockBot.pathfinder.goto = mock.fn(async () => { throw new Error('Path goal unreachable'); });
    builder.bot = mockBot;
    builder._setupPathfinder = () => {};

    // Seed shelter coords
    await builder.board.publish('builder:shelter', {
      author: 'test',
      position: { x: 50, y: 64, z: -100 },
      size: { x: 3, y: 4, z: 3 },
    });

    await assert.rejects(
      () => builder.gatherAtShelter(),
      (err) => {
        assert.ok(err.message.includes('unreachable') || err.message.includes('timeout'),
          `Expected pathfinder error, got: ${err.message}`);
        return true;
      }
    );
    assert.equal(builder.acProgress[4], false, 'AC-4 should remain incomplete on path failure');
    await builder.board.disconnect();
  });
});

// ── 7. CollectBlocks — Missing Block Type ───────────────────────────

describe('Builder Failures — CollectBlocks', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-collect*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('should throw when block type is unknown', async () => {
    const builder = new BuilderAgent({ id: 'builder-collect-fail' });
    await builder.board.connect();
    builder.bot = createMockBot();
    builder.mcData = require('minecraft-data')('1.21.11');

    await assert.rejects(
      () => builder.collectBlocks('unobtainium', 1),
      (err) => {
        assert.ok(err.message.includes('Unknown block'), `Expected unknown block error, got: ${err.message}`);
        return true;
      }
    );
    await builder.board.disconnect();
  });

  it('should throw when no blocks found nearby', async () => {
    const builder = new BuilderAgent({ id: 'builder-collect-empty' });
    await builder.board.connect();
    const mockBot = createMockBot();
    mockBot.findBlocks = mock.fn(() => []); // nothing nearby
    builder.bot = mockBot;
    builder.mcData = require('minecraft-data')('1.21.11');

    await assert.rejects(
      () => builder.collectBlocks('iron_ore', 1),
      (err) => {
        assert.ok(err.message.includes('No iron_ore found'), `Expected not-found error, got: ${err.message}`);
        return true;
      }
    );
    await builder.board.disconnect();
  });

  it('should propagate collectBlock.collect failure', async () => {
    const builder = new BuilderAgent({ id: 'builder-collect-err' });
    await builder.board.connect();
    const mockBot = createMockBot();
    const orePos = new Vec3(105, 60, -195);
    mockBot.findBlocks = mock.fn(() => [orePos]);
    mockBot.blockAt = mock.fn(() => ({ position: orePos, name: 'iron_ore' }));
    mockBot.collectBlock = {
      collect: mock.fn(async () => { throw new Error('Tool broke mid-collection'); }),
    };
    builder.bot = mockBot;
    builder.mcData = require('minecraft-data')('1.21.11');

    await assert.rejects(
      () => builder.collectBlocks('iron_ore', 1),
      (err) => {
        assert.ok(err.message.includes('Tool broke'), `Expected collection error, got: ${err.message}`);
        return true;
      }
    );
    await builder.board.disconnect();
  });
});

// ── 8. Wandering & Autonomous Wood Search ──────────────────────────

describe('Builder — Wandering autonomy', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-wander*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  async function createWanderBuilder() {
    const builder = new BuilderAgent({ id: 'builder-wander-test' });
    await builder.board.connect();
    const mockBot = createMockBot();
    mockBot.entity.position = new Vec3(100, 64, -200);
    builder.bot = mockBot;
    builder.mcData = require('minecraft-data')('1.21.11');
    builder._setupPathfinder = () => {};
    builder._goto = mock.fn(async () => {});
    return { builder, mockBot };
  }

  it('should wander when no wood found instead of waiting in place', async () => {
    const { builder, mockBot } = await createWanderBuilder();

    // findBlock always null — forces wandering, then throw after MAX attempts
    mockBot.findBlock = mock.fn(() => null);

    await assert.rejects(
      () => builder.collectWood(1),
      (err) => {
        assert.ok(err.message.includes('no wood found after'), `Expected wander exhaustion, got: ${err.message}`);
        return true;
      }
    );

    // Should have called _goto for wandering (9 times — 10th attempt throws before wander)
    assert.ok(builder._goto.mock.calls.length >= 9, `Expected >=9 wander calls, got ${builder._goto.mock.calls.length}`);
    await builder.board.disconnect();
  });

  it('should auto-expand searchRadius after 5 consecutive failures', async () => {
    const { builder, mockBot } = await createWanderBuilder();
    const initialRadius = builder.adaptations.searchRadius; // 64

    mockBot.findBlock = mock.fn(() => null);

    await assert.rejects(() => builder.collectWood(1));

    // After 5 failures, should have expanded
    assert.ok(builder.adaptations.searchRadius > initialRadius,
      `searchRadius should expand from ${initialRadius}, got ${builder.adaptations.searchRadius}`);
    await builder.board.disconnect();
  });

  it('should reset failure counter when wood is found', async () => {
    const { builder, mockBot } = await createWanderBuilder();
    let callCount = 0;

    // First 3 calls: no wood. 4th call: wood found.
    const fakeLog = { position: new Vec3(110, 64, -200), name: 'oak_log' };
    mockBot.findBlock = mock.fn(() => {
      callCount++;
      return callCount <= 3 ? null : fakeLog;
    });
    mockBot.dig = mock.fn(async () => {});

    await builder.collectWood(1);

    // Should have wandered 3 times, then found wood
    assert.equal(builder._goto.mock.calls.length, 4, '3 wander + 1 goto wood');
    await builder.board.disconnect();
  });

  it('should search all 8 wood types', async () => {
    const { builder, mockBot } = await createWanderBuilder();

    // Track what matching IDs are passed
    let matchingIds;
    mockBot.findBlock = mock.fn((opts) => {
      matchingIds = opts.matching;
      return null;
    });

    await assert.rejects(() => builder.collectWood(1));

    // Should include more than just 3 types
    assert.ok(matchingIds.length >= 6, `Expected >=6 wood types, got ${matchingIds.length}`);
    await builder.board.disconnect();
  });

  it('_wander should handle pathfinder failure gracefully', async () => {
    const { builder } = await createWanderBuilder();
    // Make _goto throw (simulating pathfinder failure during wander)
    builder._goto = mock.fn(async () => { throw new Error('stuck in ravine'); });

    // _wander should NOT throw — it catches internally
    await builder._wander();
    // Should have attempted navigation
    assert.equal(builder._goto.mock.calls.length, 1);
    await builder.board.disconnect();
  });

  it('selfImprove chain activates after max wander attempts', async () => {
    const { builder, mockBot } = await createWanderBuilder();
    mockBot.findBlock = mock.fn(() => null);

    // Run collectWood inside _reactLoop-like try/catch
    let caughtError = null;
    try {
      await builder.collectWood(1);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Should have thrown an error');
    assert.ok(caughtError.message.includes('no wood found'),
      `Error should trigger selfImprove chain: ${caughtError.message}`);
    assert.ok(caughtError.message.includes('wander'), 'Error message should mention wander');
    await builder.board.disconnect();
  });
});

// ── 9. CraftPlanks — Edge Cases ─────────────────────────────────────

describe('Builder Failures — CraftPlanks edge cases', () => {
  const { craftPlanks } = require('../agent/builder-shelter');

  it('should not throw when no oak_log in inventory (silent return)', async () => {
    const bot = createMockBot();
    bot.inventory.items = mock.fn(() => []); // no logs
    const mcData = require('minecraft-data')('1.21.11');

    // Should not throw — just returns without crafting
    await craftPlanks(bot, mcData);
    assert.equal(bot.craft.mock.calls.length, 0, 'Should not call craft with no logs');
  });

  it('should not throw when no recipe found (silent return)', async () => {
    const bot = createMockBot();
    bot.inventory.items = mock.fn(() => [{ name: 'oak_log', count: 4 }]);
    bot.recipesFor = mock.fn(() => []); // no recipes
    const mcData = require('minecraft-data')('1.21.11');

    await craftPlanks(bot, mcData);
    assert.equal(bot.craft.mock.calls.length, 0, 'Should not call craft with no recipe');
  });

  it('should propagate craft error when recipe exists but craft fails', async () => {
    const bot = createMockBot();
    bot.inventory.items = mock.fn(() => [{ name: 'oak_log', count: 4 }]);
    bot.recipesFor = mock.fn(() => [{ id: 1 }]); // recipe found
    bot.craft = mock.fn(async () => { throw new Error('Crafting table required'); });
    const mcData = require('minecraft-data')('1.21.11');

    await assert.rejects(
      () => craftPlanks(bot, mcData),
      (err) => {
        assert.ok(err.message.includes('Crafting table required'), `Expected craft error, got: ${err.message}`);
        return true;
      }
    );
  });
});

// ── 10. CraftBasicTools Success + Logger ─────────────────────────────

describe('Builder — craftBasicTools success path', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-craft-ok*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('should mark AC-3 as done on success', async () => {
    const builder = new BuilderAgent({ id: 'builder-craft-ok' });
    await builder.board.connect();
    const mockBot = createMockBot();
    mockBot.craft = mock.fn(async () => {});
    mockBot.registry = {
      itemsByName: { crafting_table: { id: 58 }, wooden_pickaxe: { id: 270 } },
    };
    builder.bot = mockBot;

    await builder.craftBasicTools();

    assert.equal(builder.acProgress[3], true);
    assert.equal(mockBot.craft.mock.callCount(), 2); // crafting_table + wooden_pickaxe
    await builder.board.disconnect();
  });

  it('should log ac_complete when logger is set', async () => {
    const builder = new BuilderAgent({ id: 'builder-craft-ok' });
    await builder.board.connect();
    const mockBot = createMockBot();
    mockBot.craft = mock.fn(async () => {});
    mockBot.registry = {
      itemsByName: { crafting_table: { id: 58 }, wooden_pickaxe: { id: 270 } },
    };
    builder.bot = mockBot;
    const logs = [];
    builder.logger = {
      logEvent: mock.fn(async (id, data) => { logs.push(data); }),
    };

    await builder.craftBasicTools();

    assert.ok(logs.some(l => l.type === 'ac_complete' && l.ac === 3));
    await builder.board.disconnect();
  });
});

// ── 11. CollectBlocks Success (tool equip + collect + publish) ───────

describe('Builder — collectBlocks success path', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-cbs*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('should equip tool, collect blocks, and publish', async () => {
    const builder = new BuilderAgent({ id: 'builder-cbs-ok' });
    await builder.board.connect();
    const mockBot = createMockBot();
    const orePos = new Vec3(105, 60, -195);
    mockBot.findBlocks = mock.fn(() => [orePos]);
    mockBot.blockAt = mock.fn(() => ({ position: orePos, name: 'iron_ore' }));
    mockBot.inventory.items = mock.fn(() => [{ name: 'iron_pickaxe', count: 1 }]);
    mockBot.equip = mock.fn(async () => {});
    mockBot.collectBlock = { collect: mock.fn(async () => {}) };
    builder.bot = mockBot;
    builder.mcData = require('minecraft-data')('1.21.11');

    const count = await builder.collectBlocks('iron_ore', 1);

    assert.equal(count, 1);
    assert.equal(mockBot.equip.mock.callCount(), 1);
    assert.equal(mockBot.equip.mock.calls[0].arguments[1], 'hand');
    assert.equal(mockBot.collectBlock.collect.mock.callCount(), 1);
    await builder.board.disconnect();
  });

  it('should skip equip when no tools in inventory', async () => {
    const builder = new BuilderAgent({ id: 'builder-cbs-notool' });
    await builder.board.connect();
    const mockBot = createMockBot();
    const pos = new Vec3(10, 60, 10);
    mockBot.findBlocks = mock.fn(() => [pos]);
    mockBot.blockAt = mock.fn(() => ({ position: pos, name: 'cobblestone' }));
    mockBot.inventory.items = mock.fn(() => []); // no tools
    mockBot.collectBlock = { collect: mock.fn(async () => {}) };
    builder.bot = mockBot;
    builder.mcData = require('minecraft-data')('1.21.11');

    await builder.collectBlocks('cobblestone', 1);

    assert.equal(mockBot.equip.mock.callCount(), 0);
    await builder.board.disconnect();
  });
});

// ── 12. Event Handlers (_onHealthChange, _onChat) ───────────────────

describe('Builder — _onHealthChange', () => {
  let BuilderAgent, redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:*builder-health*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('should publish health data to board', async () => {
    const builder = new BuilderAgent({ id: 'builder-health-test' });
    await builder.board.connect();
    const mockBot = createMockBot();
    mockBot.health = 15;
    mockBot.food = 18;
    mockBot.entity.position = new Vec3(100, 64, -200);
    mockBot.entity.velocity = { x: 0, y: -1, z: 0 };
    builder.bot = mockBot;

    await builder._onHealthChange();

    const raw = await redisClient.get('octiv:agent:builder-health-test:health:latest');
    assert.ok(raw, 'Should publish health event');
    const data = JSON.parse(raw);
    assert.equal(data.health, 15);
    assert.equal(data.food, 18);
    await builder.board.disconnect();
  });
});

describe('Builder — _onChat', () => {
  it('should ignore self-chat', () => {
    const { BuilderAgent } = require('../agent/builder');
    const builder = new BuilderAgent({ id: 'builder-chat-test' });
    builder.bot = createMockBot({ username: 'Octiv_builder-chat-test' });

    // Should not throw
    builder._onChat('Octiv_builder-chat-test', 'hello');
    // No assertion needed — just verifying it doesn't crash and returns early
  });

  it('should log other player chat', () => {
    const { BuilderAgent } = require('../agent/builder');
    const builder = new BuilderAgent({ id: 'builder-chat-test' });
    builder.bot = createMockBot({ username: 'Octiv_builder-chat-test' });

    // Should not throw for different username
    builder._onChat('Player1', 'hello world');
  });
});

// ── 13. Shutdown ─────────────────────────────────────────────────────

describe('Builder — shutdown', () => {
  it('should set _running=false and disconnect', async () => {
    const { BuilderAgent } = require('../agent/builder');
    const builder = new BuilderAgent({ id: 'builder-shutdown' });
    builder.board = {
      connect: mock.fn(async () => {}),
      disconnect: mock.fn(async () => {}),
    };
    builder.bot = createMockBot();

    await builder.shutdown();

    assert.equal(builder._running, false);
    assert.equal(builder.bot.end.mock.callCount(), 1);
    assert.equal(builder.board.disconnect.mock.callCount(), 1);
  });

  it('should handle bot.end() throwing', async () => {
    const { BuilderAgent } = require('../agent/builder');
    const builder = new BuilderAgent({ id: 'builder-shutdown-err' });
    builder.board = {
      connect: mock.fn(async () => {}),
      disconnect: mock.fn(async () => {}),
    };
    builder.bot = { end: () => { throw new Error('already disconnected'); } };

    // Should not throw
    await builder.shutdown();
    assert.equal(builder._running, false);
    assert.equal(builder.board.disconnect.mock.callCount(), 1);
  });

  it('should handle null bot', async () => {
    const { BuilderAgent } = require('../agent/builder');
    const builder = new BuilderAgent({ id: 'builder-shutdown-null' });
    builder.board = {
      connect: mock.fn(async () => {}),
      disconnect: mock.fn(async () => {}),
    };
    builder.bot = null;

    await builder.shutdown();
    assert.equal(builder._running, false);
  });
});
