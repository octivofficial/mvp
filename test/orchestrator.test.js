/**
 * Phase 3 Tests — Orchestrator, Roles, Leader Mission, Safety Monitoring
 * Usage: node --test test/orchestrator.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ── 3.1: Leader Mission Distribution ────────────────────────────
describe('LeaderAgent — Mission Distribution (Phase 3.1)', () => {
    let LeaderAgent;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        LeaderAgent = require('../agent/leader').LeaderAgent;
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:command:*');
        if (keys.length > 0) await redisClient.del(keys);
        const keys2 = await redisClient.keys('octiv:agent:builder-01:ac');
        if (keys2.length > 0) await redisClient.del(keys2);
        await redisClient.disconnect();
    });

    it('Should assign collectWood mission when AC-1 not done', async () => {
        const leader = new LeaderAgent(3);
        await leader.init();

        const mission = await leader.distributeMission('builder-01');
        assert.equal(mission.ac, 1);
        assert.equal(mission.action, 'collectWood');

        await leader.shutdown();
    });

    it('Should assign craftBasicTools when AC-1 done but AC-3 not done', async () => {
        const leader = new LeaderAgent(3);
        await leader.init();

        // Pre-seed AC-1 as done
        await redisClient.hSet('octiv:agent:builder-01:ac', 'AC-1',
            JSON.stringify({ status: 'done', ts: Date.now() }));

        const mission = await leader.distributeMission('builder-01');
        assert.equal(mission.ac, 3);
        assert.equal(mission.action, 'craftBasicTools');

        await leader.shutdown();
    });

    it('Should publish mission command to Blackboard', async () => {
        const leader = new LeaderAgent(3);
        await leader.init();

        await leader.distributeMission('builder-01');

        const raw = await redisClient.get('octiv:command:builder-01:mission:latest');
        assert.ok(raw, 'Mission should be published');
        const data = JSON.parse(raw);
        assert.ok(data.action);

        await leader.shutdown();
    });
});

// ── 3.4: Multi-Agent MCP Orchestrator ───────────────────────────
describe('MCPOrchestrator — Agent Registry (Phase 3.4)', () => {
    let MCPOrchestrator;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        await redisClient.del('octiv:agents:registry');
        MCPOrchestrator = require('../agent/mcp-orchestrator').MCPOrchestrator;
    });

    after(async () => {
        await redisClient.del('octiv:agents:registry');
        const keys = await redisClient.keys('octiv:orchestrator:*');
        if (keys.length > 0) await redisClient.del(keys);
        const keys2 = await redisClient.keys('octiv:command:*');
        if (keys2.length > 0) await redisClient.del(keys2);
        await redisClient.disconnect();
    });

    it('Should register and retrieve agents', async () => {
        await redisClient.del('octiv:agents:registry');
        const orch = new MCPOrchestrator();
        await orch.init();

        await orch.registerAgent('builder-01', 'builder');
        await orch.registerAgent('explorer-01', 'explorer');

        const all = await orch.getAllAgents();
        assert.equal(Object.keys(all).length, 2);
        assert.equal(all['builder-01'].role, 'builder');
        assert.equal(all['explorer-01'].role, 'explorer');

        await orch.shutdown();
    });

    it('Should deregister agents', async () => {
        await redisClient.del('octiv:agents:registry');
        const orch = new MCPOrchestrator();
        await orch.init();

        await orch.registerAgent('temp-01', 'builder');
        await orch.deregisterAgent('temp-01');

        const all = await orch.getAllAgents();
        assert.equal(all['temp-01'], undefined);

        await orch.shutdown();
    });

    it('Should filter agents by role', async () => {
        await redisClient.del('octiv:agents:registry');
        const orch = new MCPOrchestrator();
        await orch.init();

        await orch.registerAgent('b-01', 'builder');
        await orch.registerAgent('b-02', 'builder');
        await orch.registerAgent('e-01', 'explorer');

        const builders = await orch.getAgentsByRole('builder');
        assert.equal(Object.keys(builders).length, 2);

        await orch.shutdown();
    });

    it('Should assign task to registered agent', async () => {
        await redisClient.del('octiv:agents:registry');
        const orch = new MCPOrchestrator();
        await orch.init();

        await orch.registerAgent('task-agent', 'builder');
        const result = await orch.assignTask('task-agent', { action: 'collectWood', count: 16 });
        assert.equal(result.status, 'assigned');

        await orch.shutdown();
    });

    it('Should broadcast command to all agents', async () => {
        await redisClient.del('octiv:agents:registry');
        const orch = new MCPOrchestrator();
        await orch.init();

        await orch.registerAgent('bc-01', 'builder');
        await orch.registerAgent('bc-02', 'explorer');
        const result = await orch.broadcastCommand({ action: 'gather', shelter: { x: 50, y: 64, z: -100 } });
        assert.equal(result.targets.length, 2);
        assert.equal(result.status, 'broadcast');

        await orch.shutdown();
    });

    it('Should throw when assigning task to unregistered agent', async () => {
        await redisClient.del('octiv:agents:registry');
        const orch = new MCPOrchestrator();
        await orch.init();

        await assert.rejects(
            () => orch.assignTask('ghost-agent', { action: 'test' }),
            /not registered/
        );

        await orch.shutdown();
    });
});

// ── 3.5: Role-Based Agent System ────────────────────────────────
describe('Role-Based Agents (Phase 3.5)', () => {
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
    });

    after(async () => {
        await redisClient.del('octiv:agents:registry');
        const keys = await redisClient.keys('octiv:agent:*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
    });

    it('WoodcutterAgent should register and track collection progress', async () => {
        const { WoodcutterAgent } = require('../agent/roles/WoodcutterAgent');
        const wc = new WoodcutterAgent({ id: 'wc-01', targetCount: 3 });
        await wc.init();

        const mockBot = {
            version: '1.21.11',
            findBlock: () => ({ position: { x: 10, y: 64, z: -10 } }),
        };
        const result = await wc.execute(mockBot);
        assert.equal(result.success, true);
        assert.equal(result.collected, 1);

        const reg = await redisClient.hGet('octiv:agents:registry', 'wc-01');
        assert.ok(reg);
        const data = JSON.parse(reg);
        assert.equal(data.role, 'woodcutter');

        await wc.shutdown();
    });

    it('ExplorerAgent should track discovery radius', async () => {
        const { ExplorerAgent } = require('../agent/roles/ExplorerAgent');
        const exp = new ExplorerAgent({ id: 'exp-01', maxRadius: 50 });
        await exp.init();

        const mockBot = { entity: { position: { x: 0, y: 64, z: 0 } } };
        await exp.execute(mockBot);
        await exp.execute(mockBot);
        const result = await exp.execute(mockBot);
        assert.equal(result.radius, 30);
        assert.equal(result.totalDiscoveries, 3);

        await exp.shutdown();
    });

    it('BaseRole should throw on execute() if not overridden', async () => {
        const { BaseRole } = require('../agent/roles/BaseRole');
        const base = new BaseRole({ id: 'base-01' });
        await base.init();

        await assert.rejects(() => base.execute(), /Subclass must implement/);

        await base.shutdown();
    });
});
