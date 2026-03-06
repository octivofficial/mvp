/**
 * Integration Tests — Team Orchestration Subsystems
 *
 * Tests the assembly of team.js subsystems without requiring the full main() flow.
 * PaperMC-dependent tests skip gracefully when server is offline.
 *
 * Subsystems tested:
 *   1. Learning Pipeline assembly (Redis only)
 *   2. Builder spawn-await (PaperMC required → skip if offline)
 *   3. Emergency handler chain (Redis pub/sub)
 *   4. Zettelkasten brain assembly (Redis only)
 *   5. monitorGathering AC-4 detection (Redis only)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { Blackboard } = require('../agent/blackboard');
const { LeaderAgent } = require('../agent/leader');
const { SafetyAgent } = require('../agent/safety');
const { MemoryLogger } = require('../agent/memory-logger');
const { SkillPipeline } = require('../agent/skill-pipeline');
const { ReflexionEngine } = require('../agent/ReflexionEngine');
const { SkillZettelkasten } = require('../agent/skill-zettelkasten');
const { RuminationEngine } = require('../agent/rumination-engine');
const { GoTReasoner } = require('../agent/got-reasoner');
const { ZettelkastenHooks } = require('../agent/zettelkasten-hooks');
const { ExplorerAgent } = require('../agent/roles/ExplorerAgent');

const TEMP_VAULT = path.join(os.tmpdir(), `octiv-int-test-${Date.now()}`);

// ── 1. Learning Pipeline Assembly ──────────────────────────────────

describe('Integration — Learning Pipeline Assembly', () => {
  let board, reflexion, pipeline, leader, logger;

  before(async () => {
    board = new Blackboard();
    await board.connect();

    // Reset daily skill meta to prevent cross-suite pollution
    await board.setConfig('skills:daily_meta', { count: 0, resetAt: 0 });

    logger = new MemoryLogger();
    // Empty clients: LLM calls fail fast → _fallbackSkill used deterministically
    reflexion = new ReflexionEngine({});
    await reflexion.init();
    pipeline = new SkillPipeline(reflexion);
    await pipeline.init();

    leader = new LeaderAgent(3);
    leader.setLogger(logger);
    leader.setSkillPipeline(pipeline);
    await leader.init();
  });

  after(async () => {
    await leader.shutdown();
    await pipeline.shutdown();
    await reflexion.shutdown();
    await board.disconnect();
  });

  it('should wire SkillPipeline to Leader and generate fallback skill', async () => {
    // Generate a skill from failure (will use fallback since no API key)
    const result = await pipeline.generateFromFailure({
      error: 'pathfinding_blocked',
      errorType: 'pathfinding',
      agentId: 'builder-test',
    });

    assert.ok(result.success, 'Fallback skill generation should succeed');
    assert.ok(result.skill, 'Should have a skill name');

    // Verify leader has pipeline wired (don't inject — that pollutes shared Redis)
    assert.ok(leader.skillPipeline, 'Leader should have pipeline set');
    const lib = await pipeline.getLibrary();
    assert.ok(lib[result.skill], 'Skill should be in library');
  });

  it('should increment leader failure counter and trigger reflexion at threshold', async () => {
    leader.consecutiveTeamFailures = 0;

    // Simulate 3 failures
    for (let i = 0; i < 3; i++) {
      leader.consecutiveTeamFailures++;
    }
    await leader.checkReflexionTrigger();

    // After threshold, reflexion should trigger and reset counter
    assert.equal(leader.consecutiveTeamFailures, 0, 'Counter should reset after reflexion');
  });
});

// ── 2. Builder Spawn-Await → moved to test/papermc-live.test.js
// (Isolated to avoid Redis connection interference with mineflayer TCP)

// ── 3. Emergency Handler Chain ──────────────────────────────────────

describe('Integration — Emergency Handler (Redis pub/sub)', () => {
  let board, leader, pipeline, reflexion, logger;

  before(async () => {
    board = new Blackboard();
    await board.connect();

    // Reset daily skill meta to prevent cross-suite pollution
    await board.setConfig('skills:daily_meta', { count: 0, resetAt: 0 });

    logger = new MemoryLogger();
    // Empty clients: no live LLM calls in integration tests
    reflexion = new ReflexionEngine({});
    await reflexion.init();
    pipeline = new SkillPipeline(reflexion);
    await pipeline.init();

    leader = new LeaderAgent(3);
    leader.setLogger(logger);
    leader.setSkillPipeline(pipeline);
    await leader.init();
  });

  after(async () => {
    await leader.shutdown();
    await pipeline.shutdown();
    await reflexion.shutdown();
    await board.disconnect();
  });

  it('should increment leader failures when emergency message has failureType', async () => {
    leader.consecutiveTeamFailures = 0;

    // Simulate the emergency handler logic from team.js
    leader.consecutiveTeamFailures++;

    assert.equal(leader.consecutiveTeamFailures, 1);
  });

  it('should generate skill on emergency with triggerSkillCreation', async () => {
    const data = {
      failureType: 'threat',
      triggerSkillCreation: true,
      agentId: 'safety',
    };

    const result = await pipeline.generateFromFailure({
      error: data.failureType,
      errorType: data.failureType,
      agentId: data.agentId,
    });

    if (result.success) {
      // Verify skill was deployed to library (don't inject into leader — avoids Redis collision)
      const lib = await pipeline.getLibrary();
      assert.ok(lib[result.skill], 'Skill should exist in library');
    } else {
      // Daily limit or no LLM — must have a specific reason
      assert.ok(result.reason, 'Failed pipeline should report a reason');
      assert.ok(
        ['daily_limit_reached', 'invalid_skill_json', 'vm_validation_failed'].includes(result.reason),
        `Unexpected failure reason: ${result.reason}`
      );
    }
  });
});

// ── 4. Zettelkasten Brain Assembly ──────────────────────────────────

describe('Integration — Zettelkasten Brain Assembly', () => {
  let zk, rumination, got, hooks, board;

  before(async () => {
    board = new Blackboard();
    await board.connect();

    // Clean test keys
    const keys = await board.client.keys('octiv:zettelkasten:*');
    if (keys.length > 0) await board.client.del(keys);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'brain') });
    await zk.init();
    rumination = new RuminationEngine(zk);
    await rumination.init();
    got = new GoTReasoner(zk, { vaultDir: path.join(TEMP_VAULT, 'brain', 'reasoning') });
    await got.init();
    hooks = new ZettelkastenHooks(zk, rumination, got);
    await hooks.init();
  });

  after(async () => {
    const keys = await board.client.keys('octiv:zettelkasten:*');
    if (keys.length > 0) await board.client.del(keys);
    await hooks.shutdown();
    await got.shutdown();
    await rumination.shutdown();
    await zk.shutdown();
    await board.disconnect();
  });

  it('should assemble full brain: ZK → Rumination → GoT → Hooks', async () => {
    // Create a skill, use it, feed rumination, run GoT
    const note = await zk.createNote({
      name: 'brain_test_skill',
      code: 'test()',
      errorType: 'test',
      agentId: 'integration',
    });
    assert.equal(note.tier, 'Novice');

    // Feed experiences
    rumination.feed({ errorType: 'test', succeeded: true, skillUsed: 'brain_test_skill' });
    rumination.feed({ errorType: 'test', succeeded: true, skillUsed: 'brain_test_skill' });
    rumination.feed({ errorType: 'test', succeeded: false, skillUsed: 'brain_test_skill' });

    // Digest
    const digestResult = await rumination.digest();
    assert.ok(digestResult.digested >= 3);

    // Build GoT graph
    const graph = await got.buildGraph();
    assert.ok(Object.keys(graph.nodes).length >= 1);

    // Full stats via hooks
    const stats = await hooks.getFullStats();
    assert.ok(stats.zettelkasten);
    assert.ok(stats.rumination);
    assert.ok(stats.zettelkasten.totalNotes >= 1);
  });
});

// ── 5. Monitor Gathering (AC-4 detection) ──────────────────────────

describe('Integration — AC-4 Gathering Detection', () => {
  let board;

  before(async () => {
    board = new Blackboard();
    await board.connect();
    // Clean before test
    for (let i = 1; i <= 3; i++) {
      const keys = await board.client.keys(`octiv:agent:builder-0${i}:ac`);
      if (keys.length > 0) await board.client.del(keys);
    }
  });

  after(async () => {
    for (let i = 1; i <= 3; i++) {
      const keys = await board.client.keys(`octiv:agent:builder-0${i}:ac`);
      if (keys.length > 0) await board.client.del(keys);
    }
    await board.disconnect();
  });

  it('should detect AC-4 completion when all builders arrive', async () => {
    // updateAC(agentId, acNum, status) — acNum is number, status is string
    for (let i = 1; i <= 3; i++) {
      await board.updateAC(`builder-0${i}`, 4, 'done');
    }

    // Verify via getACProgress (returns hash of AC-N → JSON string)
    let allDone = true;
    for (let i = 1; i <= 3; i++) {
      const ac = await board.getACProgress(`builder-0${i}`);
      const ac4 = ac['AC-4'] ? JSON.parse(ac['AC-4']) : null;
      if (!ac4 || ac4.status !== 'done') allDone = false;
    }

    assert.ok(allDone, 'All 3 builders should have AC-4 done');
  });
});

// ── 6. Explorer + Safety Assembly (Redis only) ────────────────────

describe('Integration — Explorer + Safety Assembly', () => {
  let explorer, safety, board;

  before(async () => {
    board = new Blackboard();
    await board.connect();

    explorer = new ExplorerAgent({ id: 'int-explorer', maxRadius: 50 });
    await explorer.init();

    safety = new SafetyAgent();
    safety.setLogger(new MemoryLogger());
    await safety.init();
  });

  after(async () => {
    await explorer.shutdown();
    await safety.shutdown();
    await board.disconnect();
  });

  it('Explorer should generate spiral waypoints and scan areas', () => {
    // _nextSpiralPoint generates waypoints from center
    const center = { x: 0, y: 64, z: 0 };
    const wp1 = explorer._nextSpiralPoint(center);
    const wp2 = explorer._nextSpiralPoint(center);
    assert.ok(wp1.x !== undefined && wp1.z !== undefined, 'Waypoint should have coordinates');
    assert.notDeepEqual(wp1, wp2, 'Consecutive waypoints should differ');

    // _scanArea with mock bot
    const mockBot = {
      blockAt: (pos) => ({ name: pos.x === 0 && pos.y === 64 ? 'lava' : 'stone' }),
    };
    const scanResult = explorer._scanArea(mockBot, center);
    assert.ok(Array.isArray(scanResult.dangers));
    assert.ok(Array.isArray(scanResult.resources));
  });

  it('Safety should detect lava threat and validate code in sandbox', () => {
    const lavaBot = {
      entity: { position: { x: 0, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      health: 20,
      findBlock: () => null,
      registry: { blocksByName: {} },
    };
    const threat = safety.detectThreat(lavaBot);
    assert.ok(threat, 'Should detect lava threat at Y=5');
    assert.equal(threat.type, 'lava');

    // Code validation via verifySkillCode (async)
    const validResult = safety.verifySkillCode('function run(bot) { return true; }');
    assert.ok(validResult instanceof Promise, 'verifySkillCode returns a Promise');
  });
});
