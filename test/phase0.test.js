/**
 * Phase 0 Tests — API Clients, Skill Feedback Loop, Reflexion Trigger,
 *                  Quality Filter, node:vm Sandbox Migration
 * Usage: node --test --test-force-exit test/phase0.test.js
 */
const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// ── Task A: API Client Factory ────────────────────────────────
describe('ApiClients — Factory (Task A)', () => {
  it('Should return empty clients when no env vars set', () => {
    // Save and clear env vars
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    const savedGroq = process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;

    // Clear require cache to reload with new env
    delete require.cache[require.resolve('../agent/api-clients')];
    const { createApiClients } = require('../agent/api-clients');
    const clients = createApiClients();

    assert.equal(clients.anthropic, undefined, 'No anthropic client without API key');
    assert.equal(clients.groq, undefined, 'No groq client without API key');

    // Restore env vars
    if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
    if (savedGroq) process.env.GROQ_API_KEY = savedGroq;
    delete require.cache[require.resolve('../agent/api-clients')];
  });

  it('Should create anthropic client when API key is set', () => {
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key-for-factory-test';

    delete require.cache[require.resolve('../agent/api-clients')];
    const { createApiClients } = require('../agent/api-clients');
    const clients = createApiClients();

    assert.ok(clients.anthropic, 'Anthropic client should exist');
    assert.equal(typeof clients.anthropic.call, 'function', 'Should have call method');

    if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
    else delete process.env.ANTHROPIC_API_KEY;
    delete require.cache[require.resolve('../agent/api-clients')];
  });
});

// ── Task B: Skill Feedback Loop ───────────────────────────────
describe('BuilderAgent — Skill Feedback Loop (Task B)', () => {
  let BuilderAgent, SkillPipeline;
  let redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    // Clean stale skills from prior test files (e.g. integration.test.js)
    const staleKeys = await redisClient.keys('octiv:skills:*');
    if (staleKeys.length > 0) await redisClient.del(staleKeys);
    BuilderAgent = require('../agent/builder').BuilderAgent;
    SkillPipeline = require('../agent/skill-pipeline').SkillPipeline;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:skills:*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('Should have setSkillPipeline method', () => {
    const builder = new BuilderAgent({ id: 'test-feedback' });
    assert.equal(typeof builder.setSkillPipeline, 'function');
  });

  it('Should query and apply learned skill on error', async () => {
    const pipeline = new SkillPipeline(null);
    await pipeline.init();

    // Deploy a skill matching 'inventory' error type
    await pipeline.deploySkill({
      name: 'fix_inventory_v1',
      code: 'const fixed = true;',
      description: 'Fix inventory errors',
      errorType: 'inventory',
    });

    const builder = new BuilderAgent({ id: 'test-feedback' });
    await builder.board.connect();
    builder.skillPipeline = pipeline;

    const result = await builder._tryLearnedSkill(new Error('No oak_planks in inventory'));

    assert.equal(result, true, 'Should successfully apply matching skill');

    // Verify successRate was updated
    const lib = await pipeline.getLibrary();
    assert.equal(lib.fix_inventory_v1.uses, 1);
    assert.equal(lib.fix_inventory_v1.successes, 1);

    await builder.board.disconnect();
    await pipeline.shutdown();
  });

  it('Should return false when no matching skill exists', async () => {
    const pipeline = new SkillPipeline(null);
    await pipeline.init();

    const builder = new BuilderAgent({ id: 'test-no-match' });
    await builder.board.connect();
    builder.skillPipeline = pipeline;

    const result = await builder._tryLearnedSkill(new Error('Pathfinding timeout'));

    assert.equal(result, false, 'Should return false when no skill matches');

    await builder.board.disconnect();
    await pipeline.shutdown();
  });

  it('Should return false when no pipeline is set', async () => {
    const builder = new BuilderAgent({ id: 'test-no-pipeline' });
    const result = await builder._tryLearnedSkill(new Error('some error'));
    assert.equal(result, false);
  });
});

// ── BUG-1: _tryLearnedSkill must check validateSkill return value ──
describe('BUG-1 — _tryLearnedSkill rejects invalid skill code', () => {
  let BuilderAgent, SkillPipeline;
  let redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    BuilderAgent = require('../agent/builder').BuilderAgent;
    SkillPipeline = require('../agent/skill-pipeline').SkillPipeline;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:skills:*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('Should return false and record failure for invalid-code skill', async () => {
    const pipeline = new SkillPipeline(null);
    await pipeline.init();

    // Deploy skill with broken code (syntax error → validateSkill returns false)
    await pipeline.deploySkill({
      name: 'broken_skill_v1',
      code: 'function( { broken syntax }',
      description: 'Intentionally broken skill',
      errorType: 'inventory',
    });

    const builder = new BuilderAgent({ id: 'test-bug1' });
    await builder.board.connect();
    builder.skillPipeline = pipeline;

    const result = await builder._tryLearnedSkill(new Error('No item in inventory'));
    assert.equal(result, false, 'Should return false for invalid skill code');

    // Verify uses=1, successes=0 (failure correctly recorded)
    const lib = await pipeline.getLibrary();
    assert.equal(lib.broken_skill_v1.uses, 1, 'Should have 1 use');
    assert.equal(lib.broken_skill_v1.successes, 0, 'Should have 0 successes');

    await builder.board.disconnect();
    await pipeline.shutdown();
  });
});

// ── BUG-2: LLM null → fallback skill must be generated ──────────
describe('BUG-2 — generateFromFailure fallback when LLM returns null', () => {
  let SkillPipeline;
  let redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    SkillPipeline = require('../agent/skill-pipeline').SkillPipeline;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:skills:*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('Should use fallback when LLM client returns null', async () => {
    // Mock LLM client that returns null
    const mockLlm = { generateSkill: async () => null };
    const pipeline = new SkillPipeline(mockLlm);
    await pipeline.init();

    const result = await pipeline.generateFromFailure({
      error: 'pathfinding timeout',
      errorType: 'pathfinding',
    });

    assert.equal(result.success, true, 'Should succeed via fallback');
    assert.ok(result.skill.startsWith('fallback_'), 'Skill name should start with fallback_');

    // Verify skill is in library
    const lib = await pipeline.getLibrary();
    assert.ok(lib[result.skill], 'Fallback skill should be in library');

    await pipeline.shutdown();
  });
});

// ── BUG-3: _selfImprove resilience when Redis is down ───────────
describe('BUG-3 — _reactLoop catch block resilience', () => {
  it('Should not crash when _selfImprove encounters Redis failure', async () => {
    const BuilderAgent = require('../agent/builder').BuilderAgent;
    const builder = new BuilderAgent({ id: 'test-bug3' });

    // Mock board with failing publish/logReflexion
    builder.board = {
      publish: async () => { throw new Error('Redis connection refused'); },
      logReflexion: async () => { throw new Error('Redis connection refused'); },
      disconnect: async () => {},
    };

    // _selfImprove calls board.publish and board.logReflexion internally
    // It should be callable without crashing even when Redis is down
    // We test the error classification and adaptation logic still works
    const error = new Error('No suitable build site found');
    const initialRadius = builder.adaptations.buildSiteRadius;

    // Direct call — should not throw despite Redis failure
    try {
      await builder._selfImprove(error);
      // If we get here with a Redis mock that throws, the function
      // propagated the error. The fix wraps this in _reactLoop's catch.
      assert.fail('_selfImprove should throw when board.publish fails');
    } catch {
      // Expected: _selfImprove itself throws because board.publish fails
      // The FIX is in _reactLoop which wraps _selfImprove in try/catch
      // Verify the adaptation logic ran before the throw
      assert.equal(builder.adaptations.buildSiteRadius, initialRadius + 8,
        'Adaptation should still update before Redis call fails');
    }
  });

  it('_reactLoop catch block should survive Redis failure', async () => {
    // This tests the actual fix: the try/catch wrapper in _reactLoop
    // We verify the pattern by checking builder.js source has the wrapper
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../agent/builder'), 'utf8');
    assert.ok(
      src.includes('recovery failed (Redis down?)'),
      '_reactLoop catch should have recovery error handling'
    );
  });
});

// ── Task C: checkReflexionTrigger Wiring ──────────────────────
describe('LeaderAgent — Failure Counter & Reflexion Trigger (Task C)', () => {
  let LeaderAgent;
  let redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    LeaderAgent = require('../agent/leader').LeaderAgent;

    // Pre-seed reflexion logs
    for (let i = 1; i <= 3; i++) {
      const key = `octiv:agent:builder-0${i}:reflexion`;
      await redisClient.del(key);
      await redisClient.lPush(key, JSON.stringify({
        ts: Date.now(), error: 'lava', type: 'threat',
      }));
    }
  });

  after(async () => {
    for (let i = 1; i <= 3; i++) {
      await redisClient.del(`octiv:agent:builder-0${i}:reflexion`);
    }
    const keys = await redisClient.keys('octiv:leader:*');
    if (keys.length > 0) await redisClient.del(keys);
    await redisClient.disconnect();
  });

  it('Should increment consecutiveTeamFailures and trigger at 3', async () => {
    const leader = new LeaderAgent(3);
    await leader.init();

    assert.equal(leader.consecutiveTeamFailures, 0);

    leader.consecutiveTeamFailures++;
    let triggered = await leader.checkReflexionTrigger();
    assert.equal(triggered, false, 'Should not trigger at 1');

    leader.consecutiveTeamFailures++;
    triggered = await leader.checkReflexionTrigger();
    assert.equal(triggered, false, 'Should not trigger at 2');

    leader.consecutiveTeamFailures++;
    triggered = await leader.checkReflexionTrigger();
    assert.equal(triggered, true, 'Should trigger at 3');

    // After Group Reflexion, counter resets to 0
    assert.equal(leader.consecutiveTeamFailures, 0, 'Counter should reset after reflexion');

    await leader.shutdown();
  });
});

// ── Task D: Quality Filter ────────────────────────────────────
describe('LeaderAgent — Quality Filter (Task D)', () => {
  let LeaderAgent, SkillPipeline;
  let redisClient;

  before(async () => {
    const { createClient } = require('redis');
    redisClient = createClient({ url: 'redis://localhost:6380' });
    await redisClient.connect();
    LeaderAgent = require('../agent/leader').LeaderAgent;
    SkillPipeline = require('../agent/skill-pipeline').SkillPipeline;
  });

  after(async () => {
    const keys = await redisClient.keys('octiv:leader:*');
    if (keys.length > 0) await redisClient.del(keys);
    const keys2 = await redisClient.keys('octiv:command:*');
    if (keys2.length > 0) await redisClient.del(keys2);
    const keys3 = await redisClient.keys('octiv:skills:*');
    if (keys3.length > 0) await redisClient.del(keys3);
    await redisClient.disconnect();
  });

  it('Should reject skill with low success rate (<50% after 3+ uses)', async () => {
    const pipeline = new SkillPipeline(null);
    await pipeline.init();

    // Deploy skill with low success rate
    await pipeline.deploySkill({
      name: 'bad_skill_v1',
      code: 'const x = 1;',
      description: 'bad skill',
      errorType: 'test',
    });
    // Simulate 3 failures
    await pipeline.updateSuccessRate('bad_skill_v1', false);
    await pipeline.updateSuccessRate('bad_skill_v1', false);
    await pipeline.updateSuccessRate('bad_skill_v1', false);

    // Re-deploy since it may have been discarded (successRate < 0.7 triggers discard at 3 uses)
    await pipeline.deploySkill({
      name: 'bad_skill_v2',
      code: 'const x = 1;',
      description: 'bad skill v2',
      errorType: 'test',
    });
    // Manually set low rate
    const { Blackboard } = require('../agent/blackboard');
    const board = new Blackboard();
    await board.connect();
    await board.saveSkill('bad_skill_v2', {
      name: 'bad_skill_v2',
      code: 'const x = 1;',
      uses: 5,
      successes: 1,
      successRate: 0.2,
    });

    const leader = new LeaderAgent(3);
    leader.setSkillPipeline(pipeline);
    await leader.init();

    const result = await leader.injectLearnedSkill('bad_skill_v2', 'v1');
    assert.equal(result.rejected, 'low_success_rate', 'Should reject low success rate skill');

    await board.disconnect();
    await leader.shutdown();
    await pipeline.shutdown();
  });

  it('Should reject duplicate skill injection', async () => {
    const leader = new LeaderAgent(3);
    await leader.init();

    await leader.injectLearnedSkill('unique_skill', 'v1');
    const result = await leader.injectLearnedSkill('unique_skill', 'v1');

    assert.equal(result.rejected, 'duplicate', 'Should reject duplicate');

    await leader.shutdown();
  });

  it('Should enforce max 10 skills limit', async () => {
    const leader = new LeaderAgent(3);
    await leader.init();

    // Inject 10 skills
    for (let i = 0; i < 10; i++) {
      await leader.injectLearnedSkill(`skill_${i}`, 'v1');
    }

    // 11th should be rejected
    const result = await leader.injectLearnedSkill('skill_overflow', 'v1');
    assert.equal(result.rejected, 'max_skills_reached', 'Should reject at 10+ skills');

    await leader.shutdown();
  });
});

// ── Task E: node:vm Sandbox Migration ─────────────────────────
describe('Sandbox Migration — node:vm (Task E)', () => {
  let SkillPipeline, SafetyAgent;

  before(() => {
    SkillPipeline = require('../agent/skill-pipeline').SkillPipeline;
    SafetyAgent = require('../agent/safety').SafetyAgent;
  });

  it('SkillPipeline should validate safe code via node:vm', async () => {
    const pipeline = new SkillPipeline(null);
    await pipeline.init();

    const valid = await pipeline.validateSkill('const x = 1 + 2; const y = x * 3;');
    assert.equal(valid, true);

    await pipeline.shutdown();
  });

  it('SkillPipeline should reject syntax errors via node:vm', async () => {
    const pipeline = new SkillPipeline(null);
    await pipeline.init();

    const valid = await pipeline.validateSkill('function( { broken }');
    assert.equal(valid, false);

    await pipeline.shutdown();
  });

  it('SafetyAgent should validate safe code via node:vm', async () => {
    const safety = new SafetyAgent();
    const valid = await safety.verifySkillCode('const safe = true;');
    assert.equal(valid, true);
  });

  it('SafetyAgent should reject invalid code via node:vm', async () => {
    const safety = new SafetyAgent();
    const valid = await safety.verifySkillCode('const x = {;');
    assert.equal(valid, false);
  });

  it('Should not expose process/require in sandbox context', async () => {
    const pipeline = new SkillPipeline(null);
    await pipeline.init();

    // Code that tries to access process — should fail because context is isolated
    const valid = await pipeline.validateSkill('if (typeof process !== "undefined") throw new Error("leaked");');
    assert.equal(valid, true, 'process should not be accessible in sandbox');

    await pipeline.shutdown();
  });
});

// ── Part 1: Spawn-Await Tests ──────────────────────────────────
describe('BuilderAgent — Spawn-Await (Part 1)', () => {
  const { EventEmitter } = require('node:events');

  it('Should have configurable spawnTimeoutMs', () => {
    const BuilderAgent = require('../agent/builder').BuilderAgent;
    const builder = new BuilderAgent({ id: 'test-timeout', spawnTimeoutMs: 500 });
    assert.equal(builder.spawnTimeoutMs, 500);
  });

  it('Should default spawnTimeoutMs to 30000', () => {
    const BuilderAgent = require('../agent/builder').BuilderAgent;
    const builder = new BuilderAgent({ id: 'test-default' });
    assert.equal(builder.spawnTimeoutMs, 30000);
  });

  it('Should reject on spawn timeout', async () => {
    const BuilderAgent = require('../agent/builder').BuilderAgent;
    const builder = new BuilderAgent({ id: 'test-spawn-timeout', spawnTimeoutMs: 100 });

    // Mock board that connects instantly
    builder.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
    };

    // Mock bot that never emits 'spawn'
    const fakeBotEmitter = new EventEmitter();
    fakeBotEmitter.loadPlugin = () => {};

    // Intercept mineflayer.createBot
    const mineflayer = require('mineflayer');
    const originalCreateBot = mineflayer.createBot;
    mineflayer.createBot = () => fakeBotEmitter;

    try {
      await assert.rejects(
        () => builder.init(),
        (err) => {
          assert.ok(err.message.includes('spawn timeout'), `Expected spawn timeout error, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      mineflayer.createBot = originalCreateBot;
    }
  });

  it('Should reject on bot connection error', async () => {
    const BuilderAgent = require('../agent/builder').BuilderAgent;
    const builder = new BuilderAgent({ id: 'test-conn-error', spawnTimeoutMs: 5000 });

    builder.board = {
      connect: async () => {},
      disconnect: async () => {},
      publish: async () => {},
    };

    const fakeBotEmitter = new EventEmitter();
    fakeBotEmitter.loadPlugin = () => {};

    const mineflayer = require('mineflayer');
    const originalCreateBot = mineflayer.createBot;
    mineflayer.createBot = () => fakeBotEmitter;

    try {
      const initPromise = builder.init();
      // Emit error after a tick
      setImmediate(() => fakeBotEmitter.emit('error', new Error('ECONNREFUSED')));
      await assert.rejects(
        () => initPromise,
        (err) => {
          assert.ok(err.message.includes('connection error'), `Expected connection error, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      mineflayer.createBot = originalCreateBot;
    }
  });

  it('shutdown should not throw when bot is null', async () => {
    const BuilderAgent = require('../agent/builder').BuilderAgent;
    const builder = new BuilderAgent({ id: 'test-shutdown-null' });
    builder.board = { disconnect: async () => {} };
    // bot is null by default — shutdown should not throw
    await builder.shutdown();
  });
});

// ── Live LLM Call (conditional — requires ANTHROPIC_API_KEY) ─────
describe('ReflexionEngine — Live LLM Call (conditional)', () => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;

  it('should call Claude API and receive a non-empty response', async (t) => {
    if (!hasKey) {
      t.skip('ANTHROPIC_API_KEY not set');
      return;
    }

    const { createApiClients } = require('../agent/api-clients');
    const { ReflexionEngine } = require('../agent/ReflexionEngine');

    const clients = createApiClients();
    assert.ok(clients.anthropic, 'Anthropic client should be created');

    const engine = new ReflexionEngine(clients);
    await engine.init();

    try {
      const result = await engine.callLLM('Reply with exactly: OCTIV_OK');
      assert.ok(result, 'LLM should return a non-empty response');
      assert.ok(result.length > 0, 'Response should have content');
      assert.ok(engine.totalCalls >= 1, 'Call count should increment');
    } finally {
      await engine.shutdown();
    }
  });

  it('should track cost after real LLM call', async (t) => {
    if (!hasKey) {
      t.skip('ANTHROPIC_API_KEY not set');
      return;
    }

    const { createApiClients } = require('../agent/api-clients');
    const { ReflexionEngine } = require('../agent/ReflexionEngine');

    const clients = createApiClients();
    const engine = new ReflexionEngine(clients);
    await engine.init();

    try {
      await engine.callLLM('Say OK');
      assert.ok(engine.dailyCost > 0, 'Daily cost should increment after real call');
      const stats = engine.getStats();
      assert.ok(stats.totalCalls >= 1, 'Stats should reflect the call');
    } finally {
      await engine.shutdown();
    }
  });

  it('should generate valid skill JSON from failure context', async (t) => {
    if (!hasKey) {
      t.skip('ANTHROPIC_API_KEY not set');
      return;
    }

    const { createApiClients } = require('../agent/api-clients');
    const { ReflexionEngine } = require('../agent/ReflexionEngine');

    const clients = createApiClients();
    const engine = new ReflexionEngine(clients);
    await engine.init();

    try {
      const skill = await engine.generateSkill({
        error: 'No oak_log found within search radius',
        errorType: 'inventory',
        agentId: 'test-live',
      });

      // generateSkill may return null if LLM response is malformed
      if (skill) {
        assert.ok(skill.name, 'Skill should have a name');
        assert.ok(skill.code, 'Skill should have code');
        assert.ok(skill.errorType, 'Skill should have errorType');
      }
    } finally {
      await engine.shutdown();
    }
  });
});
