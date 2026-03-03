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
    return bot;
}

// mineflayer 모듈 mock
let mockBotInstance;

// ── 테스트 시작 ──────────────────────────────────────────────────

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
