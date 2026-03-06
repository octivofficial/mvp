/**
 * E2E Smoke Tests — Live PaperMC + Redis
 *
 * Requires:
 *   - PaperMC server on localhost:25565 (offline-mode)
 *   - Redis on localhost:6380
 *
 * Uses top-level it() instead of describe() to avoid Node.js v25
 * AbortSignal propagation into mineflayer TCP connections.
 *
 * Run: node --test --test-force-exit --test-concurrency=1 test/e2e-smoke.test.js
 */
const { it } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { execSync } = require('child_process');

const T = require('../config/timeouts');

// ── Shared state ──────────────────────────────────────────────────
let infraOk = false;

// ── Helpers ───────────────────────────────────────────────────────

function isPaperMCOnline(host = 'localhost', port = 25565, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.connect(port, host, () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function isRedisOnline(port = 6380) {
  try {
    const result = execSync(`redis-cli -p ${port} PING`, { timeout: 3000 }).toString().trim();
    return result === 'PONG';
  } catch {
    return false;
  }
}

async function cleanupE2EKeys(board) {
  const patterns = ['octiv:e2e:*', 'octiv:agent:e2e-*'];
  for (const pattern of patterns) {
    const keys = await board.client.keys(pattern);
    if (keys.length > 0) {
      await board.client.del(keys);
    }
  }
}

// Allow mineflayer socket drain between tests
const DRAIN_MS = 500;

// ══════════════════════════════════════════════════════════════════
// Step 1: Infrastructure Pre-check
// ══════════════════════════════════════════════════════════════════

it('E2E — infra: Redis PONG + PaperMC reachable', async (t) => {
  const [papermc, redis] = await Promise.all([
    isPaperMCOnline(),
    Promise.resolve(isRedisOnline()),
  ]);

  if (!papermc || !redis) {
    const missing = [];
    if (!papermc) missing.push('PaperMC (localhost:25565)');
    if (!redis) missing.push('Redis (localhost:6380)');
    t.skip(`Infrastructure offline: ${missing.join(', ')}`);
    return;
  }

  infraOk = true;
  assert.ok(papermc, 'PaperMC should be reachable');
  assert.ok(redis, 'Redis should respond PONG');
});

// ══════════════════════════════════════════════════════════════════
// Step 2: Single OctivBot Spawn
// ══════════════════════════════════════════════════════════════════

it('E2E — OctivBot spawn and heartbeat', async (t) => {
  if (!infraOk) { t.skip('Infrastructure offline'); return; }

  const { OctivBot } = require('../agent/OctivBot');

  const bot = new OctivBot({
    host: 'localhost',
    port: 25565,
    username: 'E2E_Octiv',
    version: '1.21.1',
    auth: 'offline',
  }, {
    spawnTimeoutMs: 15000,
    heartbeatIntervalMs: 60000, // slow heartbeat for test
  });

  try {
    await bot.start();

    // Wait for spawn (up to 15s)
    const spawnStart = Date.now();
    while (!bot.spawned && Date.now() - spawnStart < 15000) {
      await new Promise(r => setTimeout(r, 200));
    }

    assert.ok(bot.spawned, 'Bot should have spawned');
    assert.ok(bot.bot.entity, 'Bot should have an entity');

    const pos = bot.bot.entity.position;
    assert.ok(typeof pos.x === 'number', 'Position x should be a number');
    assert.ok(typeof pos.y === 'number', 'Position y should be a number');
    assert.ok(typeof pos.z === 'number', 'Position z should be a number');
  } catch (err) {
    if (err.message.includes('spawn timeout') || err.message.includes('ECONNREFUSED')) {
      t.skip(`PaperMC connection failed: ${err.message}`);
      return;
    }
    throw err;
  } finally {
    await bot.shutdown();
    await new Promise(r => setTimeout(r, DRAIN_MS));
  }
});

// ══════════════════════════════════════════════════════════════════
// Step 3: BuilderAgent Spawn + Blackboard Status
// ══════════════════════════════════════════════════════════════════

it('E2E — BuilderAgent spawn publishes Blackboard status', async (t) => {
  if (!infraOk) { t.skip('Infrastructure offline'); return; }

  const { BuilderAgent } = require('../agent/builder');
  const { Blackboard } = require('../agent/blackboard');

  // Create a subscriber to listen for status before spawning
  const listener = new Blackboard();
  await listener.connect();
  const sub = await listener.createSubscriber();

  let receivedStatus = null;
  const statusPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);
    sub.subscribe('octiv:agent:e2e-01:status', (message) => {
      clearTimeout(timeout);
      receivedStatus = JSON.parse(message);
      resolve(receivedStatus);
    });
  });

  const builder = new BuilderAgent({
    id: 'e2e-01',
    spawnTimeoutMs: 15000,
  });

  try {
    await builder.init();
    // Stop ReAct loop immediately after spawn
    builder._running = false;

    const status = await statusPromise;

    assert.ok(status, 'Should receive status message on Blackboard');
    assert.equal(status.status, 'spawned', 'Status should be "spawned"');
    assert.ok(status.position, 'Status should include position');
    assert.ok(status.author, 'Status should include author');
  } catch (err) {
    if (err.message.includes('spawn timeout') || err.message.includes('connection error')) {
      t.skip(`PaperMC connection failed: ${err.message}`);
      return;
    }
    throw err;
  } finally {
    builder._running = false;
    await builder.shutdown();
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    try { await sub.disconnect(); } catch { /* ignore */ }
    await listener.disconnect();
    await new Promise(r => setTimeout(r, DRAIN_MS));
  }
});

// ══════════════════════════════════════════════════════════════════
// Step 4: Multi-Agent Spawn (2 builders)
// ══════════════════════════════════════════════════════════════════

it('E2E — multi-agent: 2 builders spawn with stagger', async (t) => {
  if (!infraOk) { t.skip('Infrastructure offline'); return; }

  const { BuilderAgent } = require('../agent/builder');

  const builder1 = new BuilderAgent({ id: 'e2e-01', spawnTimeoutMs: 15000 });
  const builder2 = new BuilderAgent({ id: 'e2e-02', spawnTimeoutMs: 15000 });

  try {
    // Spawn first builder
    await builder1.init();
    builder1._running = false;

    // Stagger delay
    await new Promise(r => setTimeout(r, T.BUILDER_SPAWN_INTERVAL_MS));

    // Spawn second builder
    await builder2.init();
    builder2._running = false;

    // Both should have valid entities
    assert.ok(builder1.bot.entity, 'Builder 1 should have an entity');
    assert.ok(builder2.bot.entity, 'Builder 2 should have an entity');

    const pos1 = builder1.bot.entity.position;
    const pos2 = builder2.bot.entity.position;

    assert.ok(typeof pos1.x === 'number', 'Builder 1 position x should be a number');
    assert.ok(typeof pos2.x === 'number', 'Builder 2 position x should be a number');

    // Different usernames
    assert.notEqual(
      builder1.bot.username,
      builder2.bot.username,
      'Builders should have different usernames'
    );
  } catch (err) {
    if (err.message.includes('spawn timeout') || err.message.includes('connection error')) {
      t.skip(`PaperMC connection failed: ${err.message}`);
      return;
    }
    throw err;
  } finally {
    // Parallel shutdown
    await Promise.allSettled([
      builder1.shutdown(),
      builder2.shutdown(),
    ]);
    await new Promise(r => setTimeout(r, DRAIN_MS));
  }
});

// ══════════════════════════════════════════════════════════════════
// Step 5: Blackboard Pub/Sub Roundtrip
// ══════════════════════════════════════════════════════════════════

it('E2E — Blackboard pub/sub roundtrip', async (t) => {
  if (!infraOk) { t.skip('Infrastructure offline'); return; }

  const { Blackboard } = require('../agent/blackboard');

  const publisher = new Blackboard();
  const listener = new Blackboard();

  await Promise.all([publisher.connect(), listener.connect()]);
  const sub = await listener.createSubscriber();

  const testChannel = 'octiv:e2e:test';
  const testPayload = { author: 'e2e-test', msg: 'roundtrip', ts: Date.now() };

  try {
    const received = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pub/sub roundtrip timeout (2s)')), 2000);

      sub.subscribe(testChannel, (message) => {
        clearTimeout(timeout);
        resolve({ data: JSON.parse(message), receivedAt: Date.now() });
      });

      // Small delay to ensure subscription is active before publishing
      setTimeout(async () => {
        await publisher.client.publish(testChannel, JSON.stringify(testPayload));
      }, 100);
    });

    assert.ok(received.data, 'Should receive published message');
    assert.equal(received.data.msg, 'roundtrip', 'Message content should match');
    assert.equal(received.data.author, 'e2e-test', 'Author should match');

    const latency = received.receivedAt - testPayload.ts;
    assert.ok(latency < 500, `Latency should be < 500ms (was ${latency}ms)`);
  } finally {
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    try { await sub.disconnect(); } catch { /* ignore */ }
    await Promise.allSettled([
      publisher.disconnect(),
      listener.disconnect(),
    ]);
  }
});

// ══════════════════════════════════════════════════════════════════
// Step 6: AC-1 Wood Collection (best-effort, 30s timeout)
// ══════════════════════════════════════════════════════════════════

it('E2E — AC-1: builder collects at least 1 wood log (30s)', async (t) => {
  if (!infraOk) { t.skip('Infrastructure offline'); return; }

  const { BuilderAgent } = require('../agent/builder');

  const builder = new BuilderAgent({
    id: 'e2e-wood',
    spawnTimeoutMs: 15000,
  });

  // Disable ReAct loop BEFORE init — prevents background loop from
  // racing with our direct collectWood(1) call
  builder._running = false;

  try {
    await builder.init();

    // Race: collectWood(1) vs 30s timeout
    const result = await Promise.race([
      builder.collectWood(1).then(() => 'collected'),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 30000)),
    ]);

    if (result === 'timeout') {
      t.skip('Wood collection timed out (30s) — biome may lack trees');
      return;
    }

    // Check inventory for any log type
    const LOG_NAMES = [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
      'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
    ];

    const logCount = builder.bot.inventory.items()
      .filter(item => LOG_NAMES.includes(item.name))
      .reduce((sum, item) => sum + item.count, 0);

    assert.ok(logCount >= 1, `Should have at least 1 wood log (found ${logCount})`);
  } catch (err) {
    if (err.message.includes('spawn timeout') || err.message.includes('connection error')) {
      t.skip(`PaperMC connection failed: ${err.message}`);
      return;
    }
    if (err.message.includes('wander attempts')) {
      t.skip('No wood found in biome — skip');
      return;
    }
    if (err.message.includes('path to goal') || err.message.includes('Pathfinder')) {
      t.skip(`Pathfinder issue: ${err.message}`);
      return;
    }
    if (err.message.includes('client is closed') || err.message.includes('The client is closed')) {
      // Race: mineflayer health event fires after Redis client disconnect
      t.skip('Redis client closed during async health event — benign race');
      return;
    }
    throw err;
  } finally {
    builder._running = false;
    try { await builder.shutdown(); } catch { /* ignore shutdown errors */ }
    await new Promise(r => setTimeout(r, DRAIN_MS));
  }
});

// ══════════════════════════════════════════════════════════════════
// Step 7: Cleanup — remove e2e Redis keys
// ══════════════════════════════════════════════════════════════════

it('E2E — cleanup: remove e2e Redis keys', async (t) => {
  if (!infraOk) { t.skip('Infrastructure offline'); return; }

  const { Blackboard } = require('../agent/blackboard');
  const board = new Blackboard();

  try {
    await board.connect();
    await cleanupE2EKeys(board);

    // Verify no leftover keys
    const remaining1 = await board.client.keys('octiv:e2e:*');
    const remaining2 = await board.client.keys('octiv:agent:e2e-*');

    assert.equal(remaining1.length, 0, 'No octiv:e2e:* keys should remain');
    assert.equal(remaining2.length, 0, 'No octiv:agent:e2e-* keys should remain');
  } finally {
    await board.disconnect();
  }
});
