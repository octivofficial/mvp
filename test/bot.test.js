/**
 * OctivBot Unit Tests — mineflayer mock, real Redis connection
 * Usage: node --test test/bot.test.js
 *
 * Test Strategy:
 *   - mineflayer.createBot → EventEmitter mock (no real MC server needed)
 *   - Blackboard → real Redis (port 6380)
 */
const { describe, it, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

const { Vec3 } = require('vec3');

// ── mineflayer mock ──────────────────────────────────────────────
function createMockBot(overrides = {}) {
    const bot = new EventEmitter();
    bot.username = overrides.username || 'OctivBot';
    bot.health = overrides.health ?? 20;
    bot.food = overrides.food ?? 20;
    bot.entity = {
        position: overrides.position || { x: 100, y: 64, z: -200 },
        velocity: { x: 0, y: 0, z: 0 },
    };
    bot.chat = mock.fn();
    bot.end = mock.fn(() => {
        process.nextTick(() => bot.emit('end', 'closed'));
    });
    bot.quit = mock.fn(() => {
        process.nextTick(() => bot.emit('end', 'quit'));
    });
    bot.loadPlugin = mock.fn();
    bot.waitForTicks = mock.fn(async () => { });
    bot.placeBlock = mock.fn(async () => {});
    bot.equip = mock.fn(async () => {});
    bot.craft = mock.fn(async () => {});
    bot.blockAt = mock.fn((pos) => ({
        position: pos, name: 'dirt', boundingBox: 'block',
    }));
    bot.findBlock = mock.fn(() => null);
    bot.inventory = { items: mock.fn(() => []) };
    bot.version = '1.21.1';
    bot.registry = { itemsByName: {} };
    bot.pathfinder = {
        setMovements: mock.fn(),
        goto: mock.fn(async () => {}),
    };
    return bot;
}

// mineflayer module mock
let mockBotInstance;

// ── Test Suite ───────────────────────────────────────────────────

describe('OctivBot — Single Bot Stability (Phase 1.2)', () => {
    let OctivBot;
    let redisClient;

    before(async () => {
        // Connect to Redis for cleanup
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
    });

    after(async () => {
        // Cleanup test keys
        const keys = await redisClient.keys('octiv:bot:*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
    });

    beforeEach(async () => {
        // Clear Redis bot keys before each test
        const keys = await redisClient.keys('octiv:bot:*');
        if (keys.length > 0) await redisClient.del(keys);

        // Setup mineflayer mock
        mockBotInstance = createMockBot();

        // Import OctivBot
        OctivBot = require('../agent/OctivBot').OctivBot;
    });

    afterEach(() => {
        // Clear module cache for isolation
        delete require.cache[require.resolve('../agent/OctivBot')];
    });

    // ── Test 1: Spawn → Blackboard publish ──
    it('Should publish position and status to Blackboard on spawn', async () => {
        const bot = new OctivBot({
            username: 'TestBot-spawn',
        }, {
            createBotFn: () => mockBotInstance,
        });

        await bot.start(); // Wait for instance creation and handlers

        // Simulate spawn event
        mockBotInstance.emit('spawn');

        // Wait briefly for Blackboard write
        await new Promise(r => setTimeout(r, 100));

        // Check bot status in Redis
        const raw = await redisClient.get('octiv:bot:status:latest');
        assert.ok(raw, 'Bot status should be published to Redis');

        const status = JSON.parse(raw);
        assert.equal(status.username, 'TestBot-spawn');
        assert.equal(status.status, 'spawned');

        await bot.shutdown();
    });

    // ── Test 2: Periodic Heartbeat ──
    it('Should periodically update status in Redis via heartbeat', async () => {
        const bot = new OctivBot({
            username: 'TestBot-heartbeat',
        }, {
            createBotFn: () => mockBotInstance,
            heartbeatIntervalMs: 100,  // Short interval for testing
        });

        await bot.start();
        mockBotInstance.emit('spawn');
        await new Promise(r => setTimeout(r, 50));

        // Check first heartbeat
        const raw1 = await redisClient.get('octiv:bot:status:latest');
        assert.ok(raw1, 'First status should be published');
        const status1 = JSON.parse(raw1);
        const ts1 = status1.ts;

        // Simulate health change
        mockBotInstance.health = 15;
        await new Promise(r => setTimeout(r, 200));

        // Check update on second heartbeat
        const raw2 = await redisClient.get('octiv:bot:status:latest');
        const status2 = JSON.parse(raw2);

        assert.ok(status2.ts > ts1, `Timestamp should be updated. ts1: ${ts1}, ts2: ${status2.ts}`);
        assert.equal(status2.health, 15);

        await bot.shutdown();
    });

    // ── Test 3: Reconnection with exponential backoff ──
    it('Should attempt to reconnect with exponential backoff on connection error', async () => {
        let createCount = 0;
        const failingCreateBot = () => {
            createCount++;
            const failBot = createMockBot();
            if (createCount <= 2) {
                process.nextTick(() => failBot.emit('error', new Error('ECONNREFUSED')));
                process.nextTick(() => failBot.emit('end', 'Connection refused'));
            } else {
                process.nextTick(() => failBot.emit('spawn'));
            }
            return failBot;
        };

        const bot = new OctivBot({
            username: 'TestBot-reconnect',
        }, {
            createBotFn: failingCreateBot,
            maxReconnectAttempts: 5,
            baseReconnectDelayMs: 20,  // Short delay for testing
        });

        await bot.start();
        await new Promise(r => setTimeout(r, 500));

        assert.ok(createCount >= 3, `Should have attempted at least 3 connections, got: ${createCount}`);

        await bot.shutdown();
    });

    // ── Test 4: Spawn Timeout ──
    it('Should retry connection after timeout if spawn event is not emitted', async () => {
        let createCount = 0;
        const noSpawnCreateBot = () => {
            createCount++;
            const silentBot = createMockBot();
            if (createCount >= 2) {
                setTimeout(() => silentBot.emit('spawn'), 50);
            }
            return silentBot;
        };

        const bot = new OctivBot({
            username: 'TestBot-timeout',
        }, {
            createBotFn: noSpawnCreateBot,
            spawnTimeoutMs: 100,          // Short timeout for testing
            maxReconnectAttempts: 3,
            baseReconnectDelayMs: 20,
        });

        await bot.start();
        await new Promise(r => setTimeout(r, 500));

        assert.ok(createCount >= 2, `Should retry after timeout, attempts: ${createCount}`);

        await bot.shutdown();
    });

    // ── Test 5: Redis connection failure resilience ──
    it('Should not crash if Blackboard(Redis) connection fails', async () => {
        const bot = new OctivBot({
            username: 'TestBot-resilient',
        }, {
            createBotFn: () => mockBotInstance,
            redisUrl: 'redis://localhost:19999',  // Non-existent port
        });

        let threw = false;
        try {
            await bot.start();
            mockBotInstance.emit('spawn');
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {
            threw = true;
        }

        assert.equal(threw, false, 'Bot should not crash when Redis is unavailable');

        await bot.shutdown();
    });
});

describe('OctivBot — Blackboard Integration (Phase 1.3)', () => {
    let OctivBot;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        OctivBot = require('../agent/OctivBot').OctivBot;
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:bot:*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
        delete require.cache[require.resolve('../agent/OctivBot')];
    });

    it('Should publish health events to Blackboard on health change', async () => {
        const mockBot = createMockBot({ username: 'TestBot-health' });
        const bot = new OctivBot({
            username: 'TestBot-health',
        }, {
            createBotFn: () => mockBot,
            heartbeatIntervalMs: 5000,
        });

        await bot.start();
        mockBot.emit('spawn');
        await new Promise(r => setTimeout(r, 100));

        mockBot.health = 8;
        mockBot.emit('health');
        await new Promise(r => setTimeout(r, 100));

        const raw = await redisClient.get('octiv:bot:health:latest');
        assert.ok(raw, 'Health event should be published');
        const data = JSON.parse(raw);
        assert.equal(data.health, 8);

        await bot.shutdown();
    });

    it('Should respond to chat command (!status)', async () => {
        const mockBot = createMockBot({ username: 'TestBot-chat' });
        const bot = new OctivBot({
            username: 'TestBot-chat',
        }, {
            createBotFn: () => mockBot,
        });

        await bot.start();
        mockBot.emit('spawn');
        await new Promise(r => setTimeout(r, 100));

        mockBot.emit('chat', 'SomePlayer', '!status');
        await new Promise(r => setTimeout(r, 100));

        assert.ok(mockBot.chat.mock.calls.length >= 1, 'Bot should respond to chat');

        await bot.shutdown();
    });

    it('Should clean up Blackboard and bot connection on graceful shutdown', async () => {
        const mockBot = createMockBot({ username: 'TestBot-shutdown' });
        const bot = new OctivBot({
            username: 'TestBot-shutdown',
        }, {
            createBotFn: () => mockBot,
        });

        await bot.start();
        mockBot.emit('spawn');
        await new Promise(r => setTimeout(r, 100));

        await bot.shutdown();
        assert.ok(mockBot.end.mock.calls.length >= 1, 'bot.end() should be called');
    });
});

// ── AC-2 Shelter Construction Tests ─────────────────────────────
describe('BuilderAgent — Shelter Construction (AC-2)', () => {
    let BuilderAgent;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        BuilderAgent = require('../agent/builder').BuilderAgent;
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:*builder*');
        if (keys.length > 0) await redisClient.del(keys);
        const acKeys = await redisClient.keys('octiv:agent:builder*');
        if (acKeys.length > 0) await redisClient.del(acKeys);
        await redisClient.disconnect();
    });

    async function createBuilderWithMocks() {
        const builder = new BuilderAgent({ id: 'builder-test' });
        await builder.board.connect();
        const mockBot = createMockBot({
            position: new Vec3(100, 64, -200),
        });

        // Entity position must be Vec3 for .floored()
        mockBot.entity.position = new Vec3(100, 64, -200);

        // Inventory: return oak_planks item for equip
        const plankItem = { name: 'oak_planks', count: 64 };
        const logItem = { name: 'oak_log', count: 16 };
        mockBot.inventory.items = mock.fn(() => [plankItem, logItem]);

        // blockAt: ground = solid, above = air
        mockBot.blockAt = mock.fn((pos) => {
            if (pos.y <= 63) {
                return { position: pos, name: 'dirt', boundingBox: 'block' };
            }
            return { position: pos, name: 'air', boundingBox: 'empty' };
        });

        builder.bot = mockBot;

        // Stub pathfinder setup (Movements needs full bot registry)
        builder._setupPathfinder = () => {};

        return { builder, mockBot };
    }

    it('Should call placeBlock 32 times (9 floor + 14 walls + 9 roof)', async () => {
        const { builder, mockBot } = await createBuilderWithMocks();

        await builder.buildShelter();

        assert.equal(
            mockBot.placeBlock.mock.calls.length,
            32,
            `Expected 32 placeBlock calls, got ${mockBot.placeBlock.mock.calls.length}`
        );

        await builder.board.disconnect();
    });

    it('Should publish shelter coordinates to Blackboard', async () => {
        const { builder } = await createBuilderWithMocks();

        await builder.buildShelter();

        const raw = await redisClient.get('octiv:builder:shelter:latest');
        assert.ok(raw, 'Shelter position should be published to Redis');
        const data = JSON.parse(raw);
        assert.ok(data.position, 'Should have position field');
        assert.equal(typeof data.position.x, 'number');
        assert.equal(typeof data.position.y, 'number');
        assert.equal(typeof data.position.z, 'number');
        assert.deepEqual(data.size, { x: 3, y: 4, z: 3 });

        await builder.board.disconnect();
    });

    it('Should mark AC-2 as done in Redis', async () => {
        const { builder } = await createBuilderWithMocks();

        await builder.buildShelter();

        const acRaw = await redisClient.hGet('octiv:agent:builder-test:ac', 'AC-2');
        assert.ok(acRaw, 'AC-2 should be stored in Redis');
        const ac = JSON.parse(acRaw);
        assert.equal(ac.status, 'done');

        await builder.board.disconnect();
    });

    it('Should leave door gap at (dx=1, dz=0, dy=1) and (dx=1, dz=0, dy=2)', async () => {
        const { builder, mockBot } = await createBuilderWithMocks();

        const placedPositions = [];
        const origPlaceBlock = mockBot.placeBlock;
        mockBot.placeBlock = mock.fn(async (refBlock, faceVec) => {
            // The placed block position = refBlock.position + faceVec
            const placed = new Vec3(
                refBlock.position.x + faceVec.x,
                refBlock.position.y + faceVec.y,
                refBlock.position.z + faceVec.z
            );
            placedPositions.push(placed);
        });

        await builder.buildShelter();

        // Find origin from shelter publish
        const raw = await redisClient.get('octiv:builder:shelter:latest');
        const data = JSON.parse(raw);
        const origin = new Vec3(data.position.x, data.position.y, data.position.z);

        // Door positions: origin + (1, 1, 0) and origin + (1, 2, 0)
        const door1 = origin.offset(1, 1, 0);
        const door2 = origin.offset(1, 2, 0);

        const hasDoor1 = placedPositions.some(p =>
            p.x === door1.x && p.y === door1.y && p.z === door1.z
        );
        const hasDoor2 = placedPositions.some(p =>
            p.x === door2.x && p.y === door2.y && p.z === door2.z
        );

        assert.equal(hasDoor1, false, 'No block should be placed at door position (dy=1)');
        assert.equal(hasDoor2, false, 'No block should be placed at door position (dy=2)');

        await builder.board.disconnect();
    });
});

// ── AC-4 Shelter Gathering Tests ────────────────────────────────
describe('BuilderAgent — Shelter Gathering (AC-4)', () => {
    let BuilderAgent;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        BuilderAgent = require('../agent/builder').BuilderAgent;
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:*builder*');
        if (keys.length > 0) await redisClient.del(keys);
        const acKeys = await redisClient.keys('octiv:agent:builder*');
        if (acKeys.length > 0) await redisClient.del(acKeys);
        await redisClient.disconnect();
    });

    async function createGatherBuilder(id = 'builder-test') {
        const builder = new BuilderAgent({ id });
        await builder.board.connect();
        const mockBot = createMockBot({
            position: new Vec3(100, 64, -200),
        });
        mockBot.entity.position = new Vec3(100, 64, -200);
        mockBot.inventory.items = mock.fn(() => []);
        builder.bot = mockBot;
        builder._setupPathfinder = () => {};
        // Pre-seed shelter coords in Blackboard
        await builder.board.publish('builder:shelter', {
            author: 'test',
            position: { x: 50, y: 64, z: -100 },
            size: { x: 3, y: 4, z: 3 },
        });
        return { builder, mockBot };
    }

    it('Should navigate to shelter coordinates via pathfinder', async () => {
        const { builder, mockBot } = await createGatherBuilder();

        await builder.gatherAtShelter();

        assert.equal(mockBot.pathfinder.goto.mock.calls.length, 1,
            'pathfinder.goto should be called once');
        const goal = mockBot.pathfinder.goto.mock.calls[0].arguments[0];
        assert.equal(goal.x, 51); // x + 1 (center)
        assert.equal(goal.y, 65); // y + 1 (above floor)
        assert.equal(goal.z, -99); // z + 1 (center)

        await builder.board.disconnect();
    });

    it('Should mark AC-4 as done in Redis', async () => {
        const { builder } = await createGatherBuilder();

        await builder.gatherAtShelter();

        const acRaw = await redisClient.hGet('octiv:agent:builder-test:ac', 'AC-4');
        assert.ok(acRaw, 'AC-4 should be stored in Redis');
        const ac = JSON.parse(acRaw);
        assert.equal(ac.status, 'done');

        await builder.board.disconnect();
    });

    it('Should publish arrival event to Blackboard', async () => {
        const { builder } = await createGatherBuilder();

        await builder.gatherAtShelter();

        const raw = await redisClient.get('octiv:builder:arrived:latest');
        assert.ok(raw, 'Arrival event should be published');
        const data = JSON.parse(raw);
        assert.equal(data.agentId, 'builder-test');
        assert.deepEqual(data.position, { x: 50, y: 64, z: -100 });

        await builder.board.disconnect();
    });
});

// ── AC-5 Self-Improvement Tests ─────────────────────────────────
describe('BuilderAgent — Self-Improvement (AC-5)', () => {
    let BuilderAgent;
    let redisClient;

    before(async () => {
        const { createClient } = require('redis');
        redisClient = createClient({ url: 'redis://localhost:6380' });
        await redisClient.connect();
        BuilderAgent = require('../agent/builder').BuilderAgent;
    });

    after(async () => {
        const keys = await redisClient.keys('octiv:agent:builder-improve*');
        if (keys.length > 0) await redisClient.del(keys);
        await redisClient.disconnect();
    });

    async function createImproveBuilder() {
        const builder = new BuilderAgent({ id: 'builder-improve' });
        await builder.board.connect();
        const mockBot = createMockBot({
            position: new Vec3(100, 64, -200),
        });
        mockBot.entity.position = new Vec3(100, 64, -200);
        builder.bot = mockBot;
        builder._setupPathfinder = () => {};
        return builder;
    }

    it('Should expand build site radius after build_site failure', async () => {
        const builder = await createImproveBuilder();
        const originalRadius = builder.adaptations.buildSiteRadius;

        await builder._selfImprove(new Error('No suitable build site found'));

        assert.ok(builder.adaptations.buildSiteRadius > originalRadius,
            `Radius should increase from ${originalRadius}, got ${builder.adaptations.buildSiteRadius}`);

        await builder.board.disconnect();
    });

    it('Should increase wait ticks after pathfinding failure', async () => {
        const builder = await createImproveBuilder();
        const originalWait = builder.adaptations.waitTicks;

        await builder._selfImprove(new Error('Path goal unreachable'));

        assert.ok(builder.adaptations.waitTicks > originalWait,
            `Wait ticks should increase from ${originalWait}, got ${builder.adaptations.waitTicks}`);

        await builder.board.disconnect();
    });

    it('Should expand search radius after inventory failure', async () => {
        const builder = await createImproveBuilder();
        const originalRadius = builder.adaptations.searchRadius;

        await builder._selfImprove(new Error('No oak_planks in inventory'));

        assert.ok(builder.adaptations.searchRadius > originalRadius,
            `Search radius should increase from ${originalRadius}, got ${builder.adaptations.searchRadius}`);

        await builder.board.disconnect();
    });

    it('Should mark AC-5 as done and publish improvement', async () => {
        const builder = await createImproveBuilder();

        await builder._selfImprove(new Error('No suitable build site found'));

        assert.equal(builder.acProgress[5], true, 'AC-5 should be marked done');

        const acRaw = await redisClient.hGet('octiv:agent:builder-improve:ac', 'AC-5');
        assert.ok(acRaw, 'AC-5 should be in Redis');
        const ac = JSON.parse(acRaw);
        assert.equal(ac.status, 'done');

        const impRaw = await redisClient.get('octiv:agent:builder-improve:improvement:latest');
        assert.ok(impRaw, 'Improvement should be published');
        const imp = JSON.parse(impRaw);
        assert.equal(imp.type, 'expand_build_radius');

        await builder.board.disconnect();
    });

    it('Should return false when max retries exceeded', async () => {
        const builder = await createImproveBuilder();
        builder.adaptations.maxRetries = 2;

        await builder._selfImprove(new Error('No suitable build site found'));
        await builder._selfImprove(new Error('No suitable build site found'));
        const shouldRetry = await builder._selfImprove(new Error('No suitable build site found'));

        assert.equal(shouldRetry, false, 'Should not retry after max retries');

        await builder.board.disconnect();
    });
});
