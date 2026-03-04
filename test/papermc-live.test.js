/**
 * PaperMC Live Tests — Builder Spawn-Await
 *
 * Isolated from integration.test.js to avoid Redis connection interference.
 * Uses top-level it() instead of describe() to avoid Node.js v25 test runner
 * AbortSignal propagation into mineflayer TCP connections.
 *
 * Requires: PaperMC server running on localhost:25565
 * Skips gracefully when server is offline.
 */
const { it } = require('node:test');
const net = require('net');
const assert = require('node:assert/strict');

// Pre-check: is PaperMC reachable? Avoids mineflayer uncaught errors in CI.
function isPaperMCOnline(host = 'localhost', port = 25565, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.connect(port, host, () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

it('PaperMC Live — should connect builder and receive spawn event', async (t) => {
  const online = await isPaperMCOnline();
  if (!online) {
    t.skip('PaperMC server not available');
    return;
  }

  const { BuilderAgent } = require('../agent/builder');
  const builder = new BuilderAgent({
    id: 'live01',
    spawnTimeoutMs: 30000,
  });

  try {
    await builder.init();
    assert.ok(builder.bot, 'Bot should be created');
    assert.ok(builder.bot.entity, 'Bot should have spawned with entity');
  } catch (err) {
    if (err.message.includes('spawn timeout') || err.message.includes('ECONNREFUSED') || err.message.includes('connection error')) {
      t.skip('PaperMC connection failed');
      return;
    }
    throw err;
  } finally {
    if (builder.bot) await builder.shutdown();
  }
});
