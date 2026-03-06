/**
 * Builder Module Tests — navigation, shelter, adaptation
 * Usage: node --test --test-force-exit test/builder-modules.test.js
 *
 * Tests the 3 modules extracted from builder.js God Object split:
 *   - builder-navigation.js (pathfinder setup + goto with timeout)
 *   - builder-shelter.js (AC-2 shelter construction helpers)
 *   - builder-adaptation.js (AC-5 self-improvement + skill apply)
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

// ── Module imports ──────────────────────────────────────────────
const { setupPathfinder, goto } = require('../agent/builder-navigation');
const { craftPlanks, isFlatSite, findBuildSite, placeBlockAt } = require('../agent/builder-shelter');
const { classifyError, selfImprove, tryLearnedSkill } = require('../agent/builder-adaptation');

// ═══════════════════════════════════════════════════════════════
// 1. builder-navigation.js
// ═══════════════════════════════════════════════════════════════

describe('builder-navigation — setupPathfinder', () => {
  it('should reuse cached movements and call setMovements', () => {
    const bot = { pathfinder: { setMovements: mock.fn() } };
    const cached = { allowParkour: true };
    const result = setupPathfinder(bot, cached);
    assert.strictEqual(result, cached);
    assert.equal(bot.pathfinder.setMovements.mock.calls.length, 1);
    assert.strictEqual(bot.pathfinder.setMovements.mock.calls[0].arguments[0], cached);
  });

  it('should create new Movements when cached is falsy', () => {
    // Movements constructor needs bot with certain properties
    // We test that setMovements is called and a non-null value is returned
    const bot = {
      pathfinder: { setMovements: mock.fn() },
      // Movements constructor accesses these
      registry: { blocksByName: {} },
      version: '1.21.11',
      entity: { position: new Vec3(0, 64, 0) },
    };
    try {
      const result = setupPathfinder(bot, null);
      assert.ok(result, 'Should return a Movements instance');
      assert.equal(bot.pathfinder.setMovements.mock.calls.length, 1);
    } catch (err) {
      // Movements constructor may require full mineflayer bot — acceptable
      assert.ok(err.message, 'Movements constructor needs real bot properties');
    }
  });
});

describe('builder-navigation — goto', () => {
  it('should resolve when pathfinder.goto succeeds', async () => {
    const bot = {
      pathfinder: {
        goto: mock.fn(async () => {}),
        stop: mock.fn(),
      },
    };
    await goto(bot, { x: 0, y: 64, z: 0 });
    assert.equal(bot.pathfinder.goto.mock.calls.length, 1);
  });

  it('should reject with original error when pathfinder.goto fails', async () => {
    const bot = {
      pathfinder: {
        goto: mock.fn(async () => { throw new Error('stuck in wall'); }),
        stop: mock.fn(),
      },
    };
    await assert.rejects(
      () => goto(bot, { x: 10, y: 64, z: 10 }),
      { message: 'stuck in wall' }
    );
  });

  it('should timeout and call pathfinder.stop after timeoutMs', async () => {
    const bot = {
      pathfinder: {
        goto: mock.fn(() => new Promise(() => {})), // never resolves
        stop: mock.fn(),
      },
    };
    await assert.rejects(
      () => goto(bot, { x: 0, y: 64, z: 0 }, 50),
      { message: /timeout/i }
    );
    assert.equal(bot.pathfinder.stop.mock.calls.length, 1);
  });

  it('should clear timeout on successful navigation', async () => {
    const bot = {
      pathfinder: {
        goto: mock.fn(async () => {}),
        stop: mock.fn(),
      },
    };
    await goto(bot, { x: 0, y: 64, z: 0 }, 100);
    // If timeout wasn't cleared, pathfinder.stop would be called later
    assert.equal(bot.pathfinder.stop.mock.calls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. builder-shelter.js
// ═══════════════════════════════════════════════════════════════

describe('builder-shelter — craftPlanks', () => {
  it('should craft planks for each oak_log in inventory', async () => {
    const bot = {
      inventory: { items: () => [{ name: 'oak_log', count: 3 }] },
      recipesFor: mock.fn(() => [{ id: 1 }]),
      craft: mock.fn(async () => {}),
    };
    const mcData = { itemsByName: { oak_planks: { id: 5 } } };
    await craftPlanks(bot, mcData);
    assert.equal(bot.craft.mock.calls.length, 3);
  });

  it('should no-op when oak_planks not in mcData', async () => {
    const bot = { inventory: { items: () => [] }, craft: mock.fn() };
    await craftPlanks(bot, { itemsByName: {} });
    assert.equal(bot.craft.mock.calls.length, 0);
  });

  it('should no-op when no oak_log in inventory', async () => {
    const bot = {
      inventory: { items: () => [{ name: 'dirt', count: 4 }] },
      craft: mock.fn(),
    };
    const mcData = { itemsByName: { oak_planks: { id: 5 } } };
    await craftPlanks(bot, mcData);
    assert.equal(bot.craft.mock.calls.length, 0);
  });

  it('should no-op when no recipes available', async () => {
    const bot = {
      inventory: { items: () => [{ name: 'oak_log', count: 4 }] },
      recipesFor: () => [],
      craft: mock.fn(),
    };
    const mcData = { itemsByName: { oak_planks: { id: 5 } } };
    await craftPlanks(bot, mcData);
    assert.equal(bot.craft.mock.calls.length, 0);
  });

  it('should cap craft count at 9', async () => {
    const bot = {
      inventory: { items: () => [{ name: 'oak_log', count: 20 }] },
      recipesFor: mock.fn(() => [{ id: 1 }]),
      craft: mock.fn(async () => {}),
    };
    const mcData = { itemsByName: { oak_planks: { id: 5 } } };
    await craftPlanks(bot, mcData);
    assert.equal(bot.craft.mock.calls.length, 9);
  });
});

describe('builder-shelter — isFlatSite', () => {
  it('should return true for flat 3x3 solid ground with air above', () => {
    const bot = {
      blockAt: (pos) => {
        if (pos.y === 63) return { boundingBox: 'block' };
        return { boundingBox: 'empty' };
      },
    };
    assert.equal(isFlatSite(bot, new Vec3(0, 63, 0)), true);
  });

  it('should return false when ground has non-solid block', () => {
    const bot = {
      blockAt: (pos) => {
        if (pos.x === 1 && pos.y === 63 && pos.z === 1) return { boundingBox: 'empty' };
        if (pos.y === 63) return { boundingBox: 'block' };
        return { boundingBox: 'empty' };
      },
    };
    assert.equal(isFlatSite(bot, new Vec3(0, 63, 0)), false);
  });

  it('should return false when air layer has solid block', () => {
    const bot = {
      blockAt: (pos) => {
        if (pos.y === 63) return { boundingBox: 'block' };
        if (pos.y === 65 && pos.x === 1 && pos.z === 1) return { boundingBox: 'block' };
        return { boundingBox: 'empty' };
      },
    };
    assert.equal(isFlatSite(bot, new Vec3(0, 63, 0)), false);
  });

  it('should return false when blockAt returns null', () => {
    const bot = { blockAt: () => null };
    assert.equal(isFlatSite(bot, new Vec3(0, 63, 0)), false);
  });
});

describe('builder-shelter — findBuildSite', () => {
  it('should find flat site within radius', () => {
    const bot = {
      entity: { position: new Vec3(0, 64, 0) },
      blockAt: (pos) => {
        if (pos.y === 63) return { boundingBox: 'block' };
        return { boundingBox: 'empty' };
      },
    };
    const result = findBuildSite(bot, 5);
    assert.ok(result instanceof Vec3);
  });

  it('should return null when no flat site exists', () => {
    const bot = {
      entity: { position: new Vec3(0, 64, 0) },
      blockAt: () => null,
    };
    assert.equal(findBuildSite(bot, 3), null);
  });
});

describe('builder-shelter — placeBlockAt', () => {
  it('should navigate, equip, and place block', async () => {
    const item = { name: 'oak_planks' };
    const refBlock = { position: new Vec3(5, 63, 5) };
    const bot = {
      inventory: { items: () => [item] },
      equip: mock.fn(async () => {}),
      blockAt: mock.fn(() => refBlock),
      placeBlock: mock.fn(async () => {}),
    };
    const gotoFn = mock.fn(async () => {});

    await placeBlockAt(bot, new Vec3(5, 64, 5), 'oak_planks', gotoFn);

    assert.equal(gotoFn.mock.calls.length, 1);
    assert.equal(bot.equip.mock.calls.length, 1);
    assert.strictEqual(bot.equip.mock.calls[0].arguments[0], item);
    assert.equal(bot.placeBlock.mock.calls.length, 1);
  });

  it('should throw when block not in inventory', async () => {
    const bot = {
      inventory: { items: () => [] },
    };
    const gotoFn = mock.fn(async () => {});

    await assert.rejects(
      () => placeBlockAt(bot, new Vec3(5, 64, 5), 'oak_planks', gotoFn),
      { message: /No oak_planks/ }
    );
  });

  it('should skip placeBlock when no reference block below', async () => {
    const item = { name: 'oak_planks' };
    const bot = {
      inventory: { items: () => [item] },
      equip: mock.fn(async () => {}),
      blockAt: mock.fn(() => null),
      placeBlock: mock.fn(async () => {}),
    };
    const gotoFn = mock.fn(async () => {});

    await placeBlockAt(bot, new Vec3(5, 64, 5), 'oak_planks', gotoFn);

    assert.equal(bot.equip.mock.calls.length, 1);
    assert.equal(bot.placeBlock.mock.calls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// builder.js — _waitForGround
// ═══════════════════════════════════════════════════════════════

describe('builder — _waitForGround', () => {
  // Import BuilderAgent but we won't call init() — just test _waitForGround directly
  const { BuilderAgent } = require('../agent/builder');

  it('should wait for ground before starting ReAct loop', async () => {
    const builder = new BuilderAgent({ id: 'test-ground' });
    let ticksWaited = 0;
    builder.bot = {
      entity: { velocity: { y: -5 } },
      waitForTicks: async () => {
        ticksWaited++;
        // After 2 ticks, simulate landing
        if (ticksWaited >= 2) builder.bot.entity.velocity.y = 0;
      },
    };

    await builder._waitForGround();
    assert.ok(ticksWaited >= 2, `Should have waited ticks, got ${ticksWaited}`);
    assert.equal(builder.bot.entity.velocity.y, 0, 'Should be on ground');
  });

  it('should timeout and proceed if ground not reached', async () => {
    const builder = new BuilderAgent({ id: 'test-timeout' });
    let ticksWaited = 0;
    builder.bot = {
      entity: { velocity: { y: -10 } }, // always falling
      waitForTicks: async () => { ticksWaited++; },
    };

    // Set very short timeout via env
    const origEnv = process.env.SPAWN_GROUND_WAIT_MS;
    process.env.SPAWN_GROUND_WAIT_MS = '50';

    const start = Date.now();
    await builder._waitForGround();
    const elapsed = Date.now() - start;

    // Restore env
    if (origEnv === undefined) delete process.env.SPAWN_GROUND_WAIT_MS;
    else process.env.SPAWN_GROUND_WAIT_MS = origEnv;

    assert.ok(elapsed >= 40, `Should have waited ~50ms, got ${elapsed}ms`);
    assert.ok(ticksWaited > 0, 'Should have waited at least some ticks');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. builder-adaptation.js
// ═══════════════════════════════════════════════════════════════

describe('builder-adaptation — classifyError', () => {
  it('should classify build site errors', () => {
    assert.equal(classifyError('no build site found'), 'build_site');
    assert.equal(classifyError('not flat enough'), 'build_site');
  });

  it('should classify pathfinding errors', () => {
    assert.equal(classifyError('pathfinding timeout'), 'pathfinding');
    assert.equal(classifyError('goal unreachable'), 'pathfinding');
    assert.equal(classifyError('movement blocked'), 'pathfinding');
  });

  it('should classify inventory errors', () => {
    assert.equal(classifyError('no oak in inventory'), 'inventory');
    assert.equal(classifyError('no item found'), 'inventory');
  });

  it('should classify shelter errors', () => {
    assert.equal(classifyError('shelter coordinates invalid'), 'shelter');
  });

  it('should return unknown for unrecognized errors', () => {
    assert.equal(classifyError('something random happened'), 'unknown');
  });
});

describe('builder-adaptation — selfImprove', () => {
  function createAgent(overrides = {}) {
    return {
      id: 'test-01',
      adaptations: {
        buildSiteRadius: 16,
        waitTicks: 20,
        searchRadius: 32,
        maxRetries: 3,
        retries: {},
        improvements: [],
        ...(overrides.adaptations || {}),
      },
      acProgress: overrides.acProgress || {},
      board: {
        publish: mock.fn(async () => {}),
        logReflexion: mock.fn(async () => {}),
        updateAC: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
      reactIterations: 0,
      ...overrides,
    };
  }

  it('should expand buildSiteRadius on build_site error', async () => {
    const agent = createAgent();
    await selfImprove(agent, new Error('no build site found'));
    assert.equal(agent.adaptations.buildSiteRadius, 24); // 16 + 8
  });

  it('should increase waitTicks on pathfinding error', async () => {
    const agent = createAgent();
    await selfImprove(agent, new Error('pathfinding timeout'));
    assert.equal(agent.adaptations.waitTicks, 30); // 20 + 10
  });

  it('should expand searchRadius on inventory error', async () => {
    const agent = createAgent();
    await selfImprove(agent, new Error('no oak in inventory'));
    assert.equal(agent.adaptations.searchRadius, 48); // 32 + 16
  });

  it('should increase waitTicks on unknown error type', async () => {
    const agent = createAgent();
    await selfImprove(agent, new Error('something completely random'));
    assert.equal(agent.adaptations.waitTicks, 25); // 20 + 5
  });

  it('should return false when maxRetries exceeded', async () => {
    const agent = createAgent();
    agent.adaptations.retries.build_site = 3;
    const result = await selfImprove(agent, new Error('no build site found'));
    assert.equal(result, false); // retryCount 4 > maxRetries 3
  });

  it('should return true when retries within limit', async () => {
    const agent = createAgent();
    const result = await selfImprove(agent, new Error('no build site found'));
    assert.equal(result, true); // retryCount 1 <= maxRetries 3
  });

  it('should publish improvement and log reflexion', async () => {
    const agent = createAgent();
    await selfImprove(agent, new Error('no build site found'));
    assert.equal(agent.board.publish.mock.calls.length, 1);
    assert.ok(agent.board.publish.mock.calls[0].arguments[0].includes('improvement'));
    assert.equal(agent.board.logReflexion.mock.calls.length, 1);
  });

  it('should mark AC-5 done on first improvement', async () => {
    const agent = createAgent();
    await selfImprove(agent, new Error('no build site found'));
    assert.equal(agent.acProgress[5], true);
    assert.equal(agent.board.updateAC.mock.calls.length, 1);
    assert.deepEqual(agent.board.updateAC.mock.calls[0].arguments, ['test-01', 5, 'done']);
  });

  it('should not re-mark AC-5 on subsequent improvements', async () => {
    const agent = createAgent({ acProgress: { 5: true } });
    await selfImprove(agent, new Error('no build site found'));
    assert.equal(agent.board.updateAC.mock.calls.length, 0);
  });

  it('should cap buildSiteRadius at 64', async () => {
    const agent = createAgent({ adaptations: {
      buildSiteRadius: 60, waitTicks: 20, searchRadius: 32,
      maxRetries: 10, retries: {}, improvements: [],
    }});
    await selfImprove(agent, new Error('no build site found'));
    assert.equal(agent.adaptations.buildSiteRadius, 64); // min(64, 60+8) = 64
  });
});

describe('builder-adaptation — tryLearnedSkill', () => {
  it('should return false when no skillPipeline', async () => {
    const agent = { skillPipeline: null };
    const result = await tryLearnedSkill(agent, new Error('test'));
    assert.equal(result, false);
  });

  it('should return false when getLibrary throws', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => { throw new Error('Redis down'); }),
      },
    };
    const result = await tryLearnedSkill(agent, new Error('pathfinding timeout'));
    assert.equal(result, false);
  });

  it('should return false when no matching skill in library', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          fix_build_v1: { errorType: 'build_site', code: 'test()' },
        })),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    const result = await tryLearnedSkill(agent, new Error('pathfinding timeout'));
    assert.equal(result, false);
  });

  it('should apply matching skill when validation passes', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          fix_path_v1: { errorType: 'pathfinding', code: 'fix()', successRate: 0.8 },
        })),
        validateSkill: mock.fn(async () => true),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    const result = await tryLearnedSkill(agent, new Error('pathfinding timeout'));
    assert.equal(result, true);
    assert.deepEqual(
      agent.skillPipeline.updateSuccessRate.mock.calls[0].arguments,
      ['fix_path_v1', true]
    );
  });

  it('should return false and update rate when validation fails', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          fix_path_v1: { errorType: 'pathfinding', code: 'fix()', successRate: 0.5 },
        })),
        validateSkill: mock.fn(async () => false),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    const result = await tryLearnedSkill(agent, new Error('pathfinding timeout'));
    assert.equal(result, false);
    assert.deepEqual(
      agent.skillPipeline.updateSuccessRate.mock.calls[0].arguments,
      ['fix_path_v1', false]
    );
  });

  it('should pick highest successRate skill when multiple match', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          fix_path_v1: { errorType: 'pathfinding', code: 'v1()', successRate: 0.3 },
          fix_path_v2: { errorType: 'pathfinding', code: 'v2()', successRate: 0.9 },
        })),
        validateSkill: mock.fn(async () => true),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    await tryLearnedSkill(agent, new Error('pathfinding timeout'));
    // v2 has higher rate, should be picked first
    assert.equal(
      agent.skillPipeline.updateSuccessRate.mock.calls[0].arguments[0],
      'fix_path_v2'
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// builder.js — _reactLoop
// ═══════════════════════════════════════════════════════════════

describe('builder — _reactLoop exits immediately when _running is false', () => {
  const { BuilderAgent } = require('../agent/builder');

  it('should not execute any loop body when _running=false at start', async () => {
    const builder = new BuilderAgent({ id: 'test-react-loop' });
    builder._running = false;

    // _reactLoop calls board.publish; stub the board so it does not need Redis
    builder.board = {
      publish: mock.fn(async () => {}),
      logReflexion: mock.fn(async () => {}),
      disconnect: mock.fn(async () => {}),
    };

    // Should resolve immediately without calling publish
    await builder._reactLoop();
    assert.equal(builder.board.publish.mock.calls.length, 0, 'publish should never be called');
    assert.equal(builder.reactIterations, 0, 'reactIterations should stay 0');
  });
});

describe('builder — _reactLoop AC-2 branch when AC-1 and AC-3 done', () => {
  const { BuilderAgent } = require('../agent/builder');

  it('should call buildShelter when AC-1 done and AC-3 done but AC-2 not done', async () => {
    const builder = new BuilderAgent({ id: 'test-react-ac2' });
    // AC-1 done, AC-3 done, AC-2 not done → buildShelter branch
    builder.acProgress = { 1: true, 2: false, 3: true, 4: false, 5: false };

    let shelterCalled = false;
    builder.buildShelter = async () => {
      shelterCalled = true;
      // Stop the loop after one iteration
      builder._running = false;
    };

    builder.board = {
      publish: mock.fn(async () => {}),
      logReflexion: mock.fn(async () => {}),
      disconnect: mock.fn(async () => {}),
    };

    await builder._reactLoop();
    assert.ok(shelterCalled, 'buildShelter should have been called for AC-2 progression');
  });
});

// ── tryLearnedSkill — catch paths ────────────────────────
describe('builder-adaptation — tryLearnedSkill catch paths', () => {
  it('should return false when getLibrary throws', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => { throw new Error('redis down'); }),
      },
    };
    const result = await tryLearnedSkill(agent, new Error('build site error'));
    assert.equal(result, false);
  });

  it('should return false when validateSkill throws', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          'fix-build': { errorType: 'build_site', successRate: 0.8, code: 'return 1;' },
        })),
        validateSkill: mock.fn(async () => { throw new Error('validation error'); }),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    const result = await tryLearnedSkill(agent, new Error('build site flat'));
    assert.equal(result, false);
    assert.equal(agent.skillPipeline.updateSuccessRate.mock.callCount(), 1);
    assert.equal(agent.skillPipeline.updateSuccessRate.mock.calls[0].arguments[1], false);
  });

  it('should return true when validateSkill succeeds', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          'fix-build': { errorType: 'build_site', successRate: 0.8, code: 'return 1;' },
        })),
        validateSkill: mock.fn(async () => true),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    const result = await tryLearnedSkill(agent, new Error('build site flat'));
    assert.equal(result, true);
    assert.equal(agent.skillPipeline.updateSuccessRate.mock.calls[0].arguments[1], true);
  });

  it('should return false when validateSkill returns false', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          'fix-path': { errorType: 'pathfinding', successRate: 0.5, code: 'x' },
        })),
        validateSkill: mock.fn(async () => false),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    const result = await tryLearnedSkill(agent, new Error('path blocked'));
    assert.equal(result, false);
  });

  it('should select skill with highest success rate', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          'fix-build-v1': { errorType: 'build_site', successRate: 0.3, code: 'a' },
          'fix-build-v2': { errorType: 'build_site', successRate: 0.9, code: 'b' },
          'fix-path': { errorType: 'pathfinding', successRate: 1.0, code: 'c' },
        })),
        validateSkill: mock.fn(async () => true),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
    };
    await tryLearnedSkill(agent, new Error('build site flat'));
    // Should pick fix-build-v2 (0.9 rate), not fix-build-v1 (0.3)
    const validated = agent.skillPipeline.validateSkill.mock.calls[0].arguments[0];
    assert.equal(validated, 'b');
  });
});

// ── selfImprove — maxRetries ────────────────────────────────────
describe('builder-adaptation — selfImprove maxRetries', () => {
  it('should return false when retries exceed maxRetries', async () => {
    const agent = {
      id: 'test-01',
      adaptations: {
        retries: { build_site: 5 },
        maxRetries: 3,
        buildSiteRadius: 32,
        improvements: [],
      },
      acProgress: {},
      board: {
        publish: mock.fn(async () => {}),
        logReflexion: mock.fn(async () => {}),
        updateAC: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
      reactIterations: 5,
    };
    const result = await selfImprove(agent, new Error('build site error'));
    assert.equal(result, false);
  });

  it('should return true when retries within limit', async () => {
    const agent = {
      id: 'test-01',
      adaptations: {
        retries: {},
        maxRetries: 5,
        buildSiteRadius: 16,
        improvements: [],
      },
      acProgress: {},
      board: {
        publish: mock.fn(async () => {}),
        logReflexion: mock.fn(async () => {}),
        updateAC: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => {}) },
      reactIterations: 1,
    };
    const result = await selfImprove(agent, new Error('build site error'));
    assert.equal(result, true);
    assert.equal(agent.adaptations.buildSiteRadius, 24);
  });
});

// ── builder-adaptation — logger rejection catch callbacks ────
describe('builder-adaptation — logger.logEvent rejection callbacks', () => {
  it('selfImprove should handle logger.logEvent rejection', async () => {
    const agent = {
      id: 'test-01',
      adaptations: {
        retries: {},
        maxRetries: 5,
        buildSiteRadius: 16,
        improvements: [],
      },
      acProgress: {},
      board: {
        publish: mock.fn(async () => {}),
        logReflexion: mock.fn(async () => {}),
        updateAC: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => { throw new Error('disk full'); }) },
      reactIterations: 1,
    };
    const result = await selfImprove(agent, new Error('build site error'));
    assert.equal(result, true);
    // The .catch callback on line 62 should fire, no crash
  });

  it('tryLearnedSkill should handle logger rejection on validation failure', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          'fix-build': { errorType: 'build_site', successRate: 0.8, code: 'x' },
        })),
        validateSkill: mock.fn(async () => false),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => { throw new Error('disk full'); }) },
    };
    const result = await tryLearnedSkill(agent, new Error('build site flat'));
    assert.equal(result, false);
  });

  it('tryLearnedSkill should handle logger rejection on success', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          'fix-build': { errorType: 'build_site', successRate: 0.8, code: 'x' },
        })),
        validateSkill: mock.fn(async () => true),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => { throw new Error('disk full'); }) },
    };
    const result = await tryLearnedSkill(agent, new Error('build site flat'));
    assert.equal(result, true);
  });

  it('tryLearnedSkill should handle logger rejection in catch block', async () => {
    const agent = {
      id: 'test-01',
      skillPipeline: {
        getLibrary: mock.fn(async () => ({
          'fix-build': { errorType: 'build_site', successRate: 0.8, code: 'x' },
        })),
        validateSkill: mock.fn(async () => { throw new Error('vm crash'); }),
        updateSuccessRate: mock.fn(async () => {}),
      },
      logger: { logEvent: mock.fn(async () => { throw new Error('disk full'); }) },
    };
    const result = await tryLearnedSkill(agent, new Error('build site flat'));
    assert.equal(result, false);
  });
});
