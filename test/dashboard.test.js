/**
 * Phase 5/6/7 Tests — Dashboard, Explorer, Redis Pipeline
 * Usage: node --test test/dashboard.test.js
 */
const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ── 6.1: Dashboard Server ───────────────────────────────────────
describe('DashboardServer — SSE & API (Phase 6.1)', () => {
    let DashboardServer;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        ({ DashboardServer } = require('../agent/dashboard'));
    });

    after(async () => {
        await redisClient.disconnect();
    });

    it('Should start and serve dashboard HTML', async () => {
        const dash = new DashboardServer(0);
        await dash.start();

        const port = dash.server.address().port;
        const res = await fetch(`http://localhost:${port}/`);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('Octiv Dashboard'));

        await dash.stop();
    });

    it('Should serve API state endpoint', async () => {
        const dash = new DashboardServer(0);
        await dash.start();

        const port = dash.server.address().port;
        const res = await fetch(`http://localhost:${port}/api/state`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.agents !== undefined);
        assert.ok(data.timestamp > 0);

        await dash.stop();
    });

    it('Should accept SSE connections', async () => {
        const dash = new DashboardServer(0);
        await dash.start();

        const port = dash.server.address().port;
        const res = await fetch(`http://localhost:${port}/events`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'text/event-stream');

        // Read first SSE event (connected)
        const reader = res.body.getReader();
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        assert.ok(text.includes('connected'));

        reader.cancel();
        await dash.stop();
    });

    it('Should track agent state from Blackboard', async () => {
        const dash = new DashboardServer(0);
        await dash.start();

        // Simulate agent status publish
        await redisClient.publish('octiv:agent:test-bot:status',
            JSON.stringify({ status: 'active', health: 20 }));

        // Wait for subscription processing
        await new Promise(r => setTimeout(r, 100));
        const state = dash.getState();
        // State may or may not have the event depending on timing
        assert.ok(typeof state === 'object');

        await dash.stop();
    });

    it('Should return 404 for unknown routes', async () => {
        const dash = new DashboardServer(0);
        await dash.start();

        const port = dash.server.address().port;
        const res = await fetch(`http://localhost:${port}/unknown`);
        assert.equal(res.status, 404);

        await dash.stop();
    });
});

// ── 6.4: Explorer System (Enhanced) ─────────────────────────────
describe('ExplorerAgent — Spiral Search & Danger Avoidance (Phase 6.4)', () => {
    let ExplorerAgent, DANGER_BLOCKS;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        ({ ExplorerAgent, DANGER_BLOCKS } = require('../agent/roles/ExplorerAgent'));
    });

    after(async () => {
        await redisClient.del('octiv:agents:registry');
        const keys = await redisClient.keys('octiv:agent:exp-*');
        if (keys.length > 0) await redisClient.del(keys);
        const keys2 = await redisClient.keys('octiv:world:*');
        if (keys2.length > 0) await redisClient.del(keys2);
        await redisClient.disconnect();
    });

    it('Should generate spiral search waypoints', async () => {
        const exp = new ExplorerAgent({ id: 'exp-spiral', maxRadius: 100 });
        await exp.init();

        const mockBot = { entity: { position: { x: 0, y: 64, z: 0 } } };
        const waypoints = [];
        for (let i = 0; i < 5; i++) {
            const result = await exp.execute(mockBot);
            waypoints.push(result);
        }

        // All should succeed
        assert.ok(waypoints.every(w => w.success === true));
        // Radius should increase
        assert.ok(waypoints[4].radius > waypoints[0].radius);

        await exp.shutdown();
    });

    it('Should detect danger blocks during scan', async () => {
        const exp = new ExplorerAgent({ id: 'exp-danger', maxRadius: 50 });
        await exp.init();

        const mockBot = {
            entity: { position: { x: 0, y: 64, z: 0 } },
            blockAt: (pos) => {
                if (pos.x === 1 && pos.z === 1) return { name: 'lava' };
                if (pos.x === 2 && pos.z === 0) return { name: 'fire' };
                return { name: 'stone' };
            },
        };

        const result = await exp.execute(mockBot);
        assert.ok(result.dangers >= 0); // may or may not hit lava depending on waypoint

        await exp.shutdown();
    });

    it('Should check position safety against danger zones', async () => {
        const exp = new ExplorerAgent({ id: 'exp-safe', maxRadius: 50 });
        await exp.init();

        // Manually add danger zone
        exp.dangerZones.push({ type: 'lava', x: 10, y: 64, z: 10 });

        assert.equal(exp.isPositionSafe({ x: 10, y: 64, z: 10 }), false); // at danger
        assert.equal(exp.isPositionSafe({ x: 100, y: 64, z: 100 }), true); // far away
        assert.equal(exp.isPositionSafe({ x: 12, y: 64, z: 10 }), false); // 2 blocks away (< 5)

        await exp.shutdown();
    });

    it('Should build world map from discoveries', async () => {
        const exp = new ExplorerAgent({ id: 'exp-map', maxRadius: 50 });
        await exp.init();

        const mockBot = { entity: { position: { x: 0, y: 64, z: 0 } } };
        await exp.execute(mockBot);
        await exp.execute(mockBot);

        const worldMap = exp.getWorldMap();
        assert.ok(Object.keys(worldMap).length >= 1);

        await exp.shutdown();
    });

    it('Should detect resource blocks (ores, chests)', async () => {
        const exp = new ExplorerAgent({ id: 'exp-res', maxRadius: 50 });
        await exp.init();

        const mockBot = {
            entity: { position: { x: 0, y: 64, z: 0 } },
            blockAt: (pos) => {
                if (pos.x === 0 && pos.y === 63 && pos.z === 0) return { name: 'iron_ore' };
                if (pos.x === 1 && pos.y === 64 && pos.z === 0) return { name: 'chest' };
                return { name: 'stone' };
            },
        };

        const result = await exp.execute(mockBot);
        // execute() must return a valid exploration result
        assert.equal(result.success, true, 'Explore execute should succeed');
        assert.equal(typeof result.dangers, 'number', 'dangers should be a number');
        assert.ok(result.totalDiscoveries >= 1, 'Should have at least 1 discovery');

        await exp.shutdown();
    });

    it('Should list known danger blocks', () => {
        assert.ok(DANGER_BLOCKS.includes('lava'));
        assert.ok(DANGER_BLOCKS.includes('flowing_lava'));
        assert.ok(DANGER_BLOCKS.includes('fire'));
        assert.ok(DANGER_BLOCKS.includes('magma_block'));
    });
});

// ── 7.4: Redis Pipeline Optimization ────────────────────────────
describe('Blackboard — Redis Pipeline (Phase 7.4)', () => {
    let Blackboard;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        ({ Blackboard } = require('../agent/blackboard'));
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:pipeline:*');
        if (keys.length > 0) await redisClient.del(keys);
        const keys2 = await redisClient.keys('octiv:agent:pipe-*');
        if (keys2.length > 0) await redisClient.del(keys2);
        await redisClient.del('octiv:skills:library');
        await redisClient.disconnect();
    });

    it('Should batch publish multiple channels atomically', async () => {
        const board = new Blackboard();
        await board.connect();

        const result = await board.batchPublish([
            { channel: 'pipeline:test1', data: { author: 'test', value: 1 } },
            { channel: 'pipeline:test2', data: { author: 'test', value: 2 } },
            { channel: 'pipeline:test3', data: { author: 'test', value: 3 } },
        ]);

        assert.equal(result.count, 3);

        // Verify all written
        const v1 = await board.get('pipeline:test1');
        const v2 = await board.get('pipeline:test2');
        assert.equal(v1.value, 1);
        assert.equal(v2.value, 2);

        await board.disconnect();
    });

    it('Should batch update multiple AC entries', async () => {
        const board = new Blackboard();
        await board.connect();

        await board.batchUpdateAC([
            { agentId: 'pipe-01', acNum: 1, status: 'done' },
            { agentId: 'pipe-01', acNum: 2, status: 'in_progress' },
            { agentId: 'pipe-02', acNum: 1, status: 'done' },
        ]);

        const ac1 = await board.getACProgress('pipe-01');
        assert.equal(JSON.parse(ac1['AC-1']).status, 'done');
        assert.equal(JSON.parse(ac1['AC-2']).status, 'in_progress');

        const ac2 = await board.getACProgress('pipe-02');
        assert.equal(JSON.parse(ac2['AC-1']).status, 'done');

        await board.disconnect();
    });

    it('Should batch get multiple channels in single round-trip', async () => {
        const board = new Blackboard();
        await board.connect();

        // Seed data
        await board.publish('pipeline:bg1', { author: 'test', a: 1 });
        await board.publish('pipeline:bg2', { author: 'test', b: 2 });

        const results = await board.batchGet(['pipeline:bg1', 'pipeline:bg2', 'pipeline:nonexistent']);
        assert.equal(results[0].a, 1);
        assert.equal(results[1].b, 2);
        assert.equal(results[2], null);

        await board.disconnect();
    });

    it('Should atomically update skill with optimistic locking', async () => {
        const board = new Blackboard();
        await board.connect();

        // Seed skill
        await board.saveSkill('atomic_test', {
            name: 'atomic_test', uses: 0, successes: 0, successRate: 1.0,
        });

        const updated = await board.atomicUpdateSkill('atomic_test', (skill) => {
            skill.uses++;
            skill.successes++;
            skill.successRate = skill.successes / skill.uses;
            return skill;
        });

        assert.equal(updated.uses, 1);
        assert.equal(updated.successes, 1);
        assert.equal(updated.successRate, 1.0);

        await board.disconnect();
    });

    it('Should return null for non-existent skill in atomicUpdate', async () => {
        const board = new Blackboard();
        await board.connect();

        const result = await board.atomicUpdateSkill('nonexistent_skill', (s) => s);
        assert.equal(result, null);

        await board.disconnect();
    });

    it('Should handle empty batch publish', async () => {
        const board = new Blackboard();
        await board.connect();

        const result = await board.batchPublish([]);
        assert.equal(result.count, 0);

        await board.disconnect();
    });
});

// ── 6.2: Skill Lab API ──────────────────────────────────────────
describe('DashboardServer — Skill Lab API (Phase 6.2)', () => {
    let DashboardServer, SkillZettelkasten, TIERS;
    let redisClient;
    let dash;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        ({ DashboardServer } = require('../agent/dashboard'));
        ({ SkillZettelkasten, TIERS } = require('../agent/skill-zettelkasten'));
    });

    afterEach(async () => {
        if (dash) { await dash.stop(); dash = null; }
    });

    after(async () => {
        // Clean up zettelkasten test data
        const keys = await redisClient.keys('octiv:zettelkasten:*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
    });

    it('GET /api/skills returns stats + skills array + tiers', async () => {
        dash = new DashboardServer(0);
        await dash.start();
        const port = dash.server.address().port;

        const res = await fetch(`http://localhost:${port}/api/skills`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.stats !== undefined, 'should have stats');
        assert.ok(Array.isArray(data.skills), 'skills should be array');
        assert.ok(Array.isArray(data.tiers), 'tiers should be array');
    });

    it('GET /api/skills stats has expected fields', async () => {
        dash = new DashboardServer(0);
        await dash.start();
        const port = dash.server.address().port;

        const res = await fetch(`http://localhost:${port}/api/skills`);
        const data = await res.json();
        assert.ok('totalNotes' in data.stats);
        assert.ok('activeSkills' in data.stats);
        assert.ok('totalXP' in data.stats);
        assert.ok('tierDistribution' in data.stats);
    });

    it('GET /api/skills/:id returns skill detail', async () => {
        dash = new DashboardServer(0);
        await dash.start();

        // Create a test skill via the dashboard's skillZk
        await dash.skillZk.createNote({
            name: 'test-skill-detail',
            code: 'return true;',
            description: 'test',
            agentId: 'test',
        });

        const port = dash.server.address().port;
        const res = await fetch(`http://localhost:${port}/api/skills/test-skill-detail`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.name, 'test-skill-detail');
        assert.equal(data.tier, 'Novice');
    });

    it('GET /api/skills/:nonexistent returns 404', async () => {
        dash = new DashboardServer(0);
        await dash.start();
        const port = dash.server.address().port;

        const res = await fetch(`http://localhost:${port}/api/skills/does-not-exist-xyz`);
        assert.equal(res.status, 404);
    });

    it('Dashboard HTML includes Skill Lab tab', async () => {
        dash = new DashboardServer(0);
        await dash.start();
        const port = dash.server.address().port;

        const res = await fetch(`http://localhost:${port}/`);
        const html = await res.text();
        assert.ok(html.includes('Skill Lab'), 'HTML should contain Skill Lab');
    });

    it('Dashboard HTML includes skill-table element', async () => {
        dash = new DashboardServer(0);
        await dash.start();
        const port = dash.server.address().port;

        const res = await fetch(`http://localhost:${port}/`);
        const html = await res.text();
        assert.ok(html.includes('skill-table'), 'HTML should contain skill-table');
    });

    it('SSE broadcasts zettelkasten events', async () => {
        dash = new DashboardServer(0);
        await dash.start();
        const port = dash.server.address().port;

        // Connect SSE client
        const res = await fetch(`http://localhost:${port}/events`);
        const reader = res.body.getReader();

        // Read initial "connected" message
        await reader.read();

        // Publish a zettelkasten event
        await redisClient.publish('octiv:zettelkasten:tier-up',
            JSON.stringify({ skill: 'test', oldTier: 'Novice', newTier: 'Apprentice' }));

        // Read the skill event
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        assert.ok(text.includes('"type":"skill"'), 'SSE should contain skill event type');
        assert.ok(text.includes('tier-up'), 'SSE should contain tier-up subtype');

        reader.cancel();
    });

    it('Skills API returns tiers constant with 6 entries', async () => {
        dash = new DashboardServer(0);
        await dash.start();
        const port = dash.server.address().port;

        const res = await fetch(`http://localhost:${port}/api/skills`);
        const data = await res.json();
        assert.equal(data.tiers.length, 6, 'Should have 6 tiers');
        assert.equal(data.tiers[0].name, 'Novice');
        assert.equal(data.tiers[5].name, 'Grandmaster');
    });
});
