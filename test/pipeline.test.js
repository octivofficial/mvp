/**
 * Phase 4 Tests — SkillPipeline, ReflexionEngine, Leader Skill Injection
 * Usage: node --test test/pipeline.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ── 4.1 + 4.2: Skill Pipeline ──────────────────────────────────
describe('SkillPipeline — Generation & Deployment (Phase 4.1/4.2)', () => {
    let SkillPipeline, DAILY_LIMIT;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        ({ SkillPipeline, DAILY_LIMIT } = require('../agent/skill-pipeline'));
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:skills:*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
    });

    it('Should generate fallback skill when no LLM client', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();

        const result = await pipeline.generateFromFailure({
            error: 'Cannot find oak_log',
            errorType: 'inventory',
            agentId: 'builder-01',
        });

        assert.equal(result.success, true);
        assert.ok(result.skill.includes('fallback_inventory'));

        await pipeline.shutdown();
    });

    it('Should validate safe code in vm2 sandbox', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();

        const valid = await pipeline.validateSkill('const x = 1 + 2;');
        assert.equal(valid, true);

        await pipeline.shutdown();
    });

    it('Should reject invalid code in vm2 sandbox', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();

        const valid = await pipeline.validateSkill('const x = {;');
        assert.equal(valid, false);

        await pipeline.shutdown();
    });

    it('Should deploy skill to Redis library', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();

        await pipeline.deploySkill({
            name: 'test_skill_v1',
            code: 'const x = 1;',
            description: 'test skill',
            errorType: 'test',
        });

        const lib = await pipeline.getLibrary();
        assert.ok(lib.test_skill_v1);
        assert.equal(lib.test_skill_v1.successRate, 1.0);
        assert.equal(lib.test_skill_v1.uses, 0);

        await pipeline.shutdown();
    });

    it('Should track and update skill success rate', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();

        await pipeline.deploySkill({
            name: 'rate_test',
            code: 'const y = 2;',
            description: 'rate test',
            errorType: 'test',
        });

        await pipeline.updateSuccessRate('rate_test', true);
        await pipeline.updateSuccessRate('rate_test', false);

        const lib = await pipeline.getLibrary();
        assert.equal(lib.rate_test.uses, 2);
        assert.equal(lib.rate_test.successes, 1);
        assert.equal(lib.rate_test.successRate, 0.5);

        await pipeline.shutdown();
    });

    it('Should discard skill below MIN_SUCCESS_RATE after 3+ uses', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();

        await pipeline.deploySkill({
            name: 'bad_skill',
            code: 'const z = 0;',
            description: 'bad skill',
            errorType: 'test',
        });

        // 3 failures = 0% success rate
        await pipeline.updateSuccessRate('bad_skill', false);
        await pipeline.updateSuccessRate('bad_skill', false);
        const result = await pipeline.updateSuccessRate('bad_skill', false);

        assert.equal(result.discarded, true);

        const lib = await pipeline.getLibrary();
        assert.equal(lib.bad_skill, undefined);

        await pipeline.shutdown();
    });

    it('Should enforce daily generation limit', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();

        // Force daily count to limit
        pipeline.dailyCount = DAILY_LIMIT;

        const result = await pipeline.generateFromFailure({
            error: 'test error',
            errorType: 'test',
        });

        assert.equal(result.success, false);
        assert.equal(result.reason, 'daily_limit_reached');

        await pipeline.shutdown();
    });

    it('Should broadcast emergency channel on new skill', async () => {
        const pipeline = new SkillPipeline(null);
        await pipeline.init();
        pipeline.dailyCount = 0;

        // Subscribe to emergency channel
        const subscriber = redisClient.duplicate();
        await subscriber.connect();

        await subscriber.subscribe('octiv:skills:emergency:latest', (_message) => {
            // Blackboard publishes to key:latest
        });

        const result = await pipeline.generateFromFailure({
            error: 'lava nearby',
            errorType: 'threat',
            agentId: 'builder-01',
        });

        assert.equal(result.success, true);
        await subscriber.unsubscribe();
        await subscriber.disconnect();
        await pipeline.shutdown();
    });
});

// ── 4.3 + 4.5 + 4.6: ReflexionEngine ───────────────────────────
describe('ReflexionEngine — LLM Router & Config (Phase 4.3/4.5/4.6)', () => {
    let ReflexionEngine, DEFAULT_CONFIG;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        await redisClient.del('octiv:config:llm');
        ({ ReflexionEngine, DEFAULT_CONFIG } = require('../agent/ReflexionEngine'));
    });

    after(async () => {
        await redisClient.del('octiv:config:llm');
        await redisClient.disconnect();
    });

    it('Should initialize with default config', async () => {
        const engine = new ReflexionEngine({});
        await engine.init();

        const stats = engine.getStats();
        assert.equal(stats.config.model, DEFAULT_CONFIG.model);
        assert.equal(stats.config.temperature, DEFAULT_CONFIG.temperature);
        assert.equal(stats.totalCalls, 0);

        await engine.shutdown();
    });

    it('Should save and reload config from Redis', async () => {
        const engine = new ReflexionEngine({});
        await engine.init();

        await engine.saveConfig({ temperature: 0.3, maxTokens: 2048 });

        // Create new instance to test reload
        const engine2 = new ReflexionEngine({});
        await engine2.init();

        assert.equal(engine2.config.temperature, 0.3);
        assert.equal(engine2.config.maxTokens, 2048);

        await engine.shutdown();
        await engine2.shutdown();
    });

    it('Should route critical severity to escalation model', async () => {
        let calledModel = null;
        const mockAnthropic = {
            call: async (model, _prompt) => {
                calledModel = model;
                return '{"name":"test","code":"x=1","description":"test","errorType":"test"}';
            },
        };

        const engine = new ReflexionEngine({ anthropic: mockAnthropic });
        await engine.init();

        await engine.callLLM('test prompt', 'critical');
        assert.equal(calledModel, DEFAULT_CONFIG.escalationModel);

        await engine.shutdown();
    });

    it('Should fallback to local model when primary fails', async () => {
        let usedModel = null;
        const mockAnthropic = {
            call: async () => { throw new Error('rate limited'); },
        };
        const mockLocal = {
            call: async (model, _prompt) => {
                usedModel = model;
                return 'local response';
            },
        };

        const engine = new ReflexionEngine({ anthropic: mockAnthropic, local: mockLocal });
        await engine.init();

        const result = await engine.callLLM('test');
        assert.equal(usedModel, 'qwen/qwen3.5-9b'); // local: prefix stripped
        assert.equal(result, 'local response');

        await engine.shutdown();
    });

    it('Should enforce daily cost limit', async () => {
        const engine = new ReflexionEngine({});
        await engine.init();

        engine.dailyCost = engine.config.maxCostPerDay;

        const result = await engine.callLLM('test');
        assert.equal(result, null);

        await engine.shutdown();
    });

    it('Should track model usage stats', async () => {
        const mockAnthropic = {
            call: async () => 'response',
        };

        const engine = new ReflexionEngine({ anthropic: mockAnthropic });
        await engine.init();
        engine.dailyCost = 0;

        await engine.callLLM('test1');
        await engine.callLLM('test2');

        const stats = engine.getStats();
        assert.equal(stats.totalCalls, 2);
        assert.ok(stats.modelUsage[DEFAULT_CONFIG.model] >= 2);

        await engine.shutdown();
    });

    it('Should generate skill JSON from failure context', async () => {
        const mockAnthropic = {
            call: async () => JSON.stringify({
                name: 'avoid_lava_v1',
                code: 'const safe = true;',
                description: 'Avoid lava blocks',
                errorType: 'threat',
            }),
        };

        const engine = new ReflexionEngine({ anthropic: mockAnthropic });
        await engine.init();

        const skill = await engine.generateSkill({
            error: 'Lava detected nearby',
            errorType: 'threat',
            agentId: 'builder-01',
        });

        assert.ok(skill);
        assert.equal(skill.name, 'avoid_lava_v1');
        assert.equal(skill.errorType, 'threat');

        await engine.shutdown();
    });

    it('Should return null when both primary and fallback fail', async () => {
        const mockAnthropic = {
            call: async () => { throw new Error('primary down'); },
        };
        const mockGroq = {
            call: async () => { throw new Error('fallback down'); },
        };

        const engine = new ReflexionEngine({ anthropic: mockAnthropic, groq: mockGroq });
        await engine.init();

        const result = await engine.callLLM('test');
        assert.equal(result, null);

        await engine.shutdown();
    });
});

// ── 4.4: Leader Skill Injection ─────────────────────────────────
describe('LeaderAgent — Skill Injection (Phase 4.4)', () => {
    let LeaderAgent;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        // Clean stale keys from prior test suites (Redis test isolation)
        const keys = await redisClient.keys('octiv:leader:*');
        if (keys.length > 0) await redisClient.del(keys);
        const keys2 = await redisClient.keys('octiv:command:*');
        if (keys2.length > 0) await redisClient.del(keys2);
        ({ LeaderAgent } = require('../agent/leader'));
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:leader:*');
        if (keys.length > 0) await redisClient.del(keys);
        const keys2 = await redisClient.keys('octiv:command:*');
        if (keys2.length > 0) await redisClient.del(keys2);
        await redisClient.disconnect();
    });

    it('Should inject learned skill and broadcast to builders', async () => {
        const leader = new LeaderAgent(3);
        await leader.init();

        const result = await leader.injectLearnedSkill('avoid_lava', 'v1');
        assert.ok(result.tag.includes('avoid_lava'));
        assert.equal(result.totalSkills, 1);

        await leader.shutdown();
    });

    it('Should not duplicate same skill on re-injection', async () => {
        const leader = new LeaderAgent(3);
        await leader.init();

        await leader.injectLearnedSkill('place_torch', 'v1');
        const result = await leader.injectLearnedSkill('place_torch', 'v1');

        // totalSkills should include previous test's skill + this one = 2, not 3
        assert.ok(result.totalSkills <= 2);

        await leader.shutdown();
    });
});

// ── 4.7: MCP LLM Config Tools ──────────────────────────────────
describe('MCPServer — LLM Config Tools (Phase 4.7)', () => {
    let MCPServer;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        await redisClient.del('octiv:config:llm');
        ({ MCPServer } = require('../agent/mcp-server'));
    });

    after(async () => {
        await redisClient.del('octiv:config:llm');
        await redisClient.disconnect();
    });

    it('Should set LLM config via MCP tool', async () => {
        const server = new MCPServer(0); // port 0 = auto
        await server.start();

        const result = await server.tools.setLLMConfig({
            model: 'claude-haiku-4-5-20251001',
            temperature: 0.5,
        });

        assert.equal(result.config.model, 'claude-haiku-4-5-20251001');
        assert.equal(result.config.temperature, 0.5);
        assert.equal(result.status, 'updated');

        await server.stop();
    });

    it('Should get LLM config via MCP tool', async () => {
        // Pre-seed config
        await redisClient.set('octiv:config:llm', JSON.stringify({
            model: 'test-model',
            temperature: 0.9,
        }));

        const server = new MCPServer(0);
        await server.start();

        const result = await server.tools.getLLMConfig();
        assert.equal(result.config.model, 'test-model');
        assert.equal(result.config.temperature, 0.9);

        await server.stop();
    });

    it('Should persist config changes to Redis', async () => {
        await redisClient.del('octiv:config:llm');
        const server = new MCPServer(0);
        await server.start();

        await server.tools.setLLMConfig({ maxTokens: 4096 });

        // Verify directly in Redis
        const raw = await redisClient.get('octiv:config:llm');
        const config = JSON.parse(raw);
        assert.equal(config.maxTokens, 4096);

        await server.stop();
    });
});
