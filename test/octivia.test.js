const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert');
const { startOctivia } = require('../agent/octivia.js');

// ── Mocks ─────────────────────────────────────────────────────────

const makeBoard = () => ({
  connect: mock.fn(async () => {}),
  disconnect: mock.fn(async () => {}),
  publish: mock.fn(async () => {}),
  getConfig: mock.fn(async () => null),
  setConfig: mock.fn(async () => {}),
  createSubscriber: mock.fn(async () => ({
    subscribe: mock.fn(async () => {}),
  })),
});

// Mock spawn — returns a fake gateway process
const makeSpawn = () => mock.fn((_cmd, _args) => ({
  pid: 99999,
  on: mock.fn(),
  once: mock.fn(),
  kill: mock.fn(),
}));

// ── startOctivia() ────────────────────────────────────────────────

describe('startOctivia()', () => {
  let origObsidian;

  before(() => {
    // Stub ObsidianOrganizer
    origObsidian = require.cache[require.resolve('../agent/obsidian-agent.js')];
    require.cache[require.resolve('../agent/obsidian-agent.js')] = {
      id: require.resolve('../agent/obsidian-agent.js'),
      filename: require.resolve('../agent/obsidian-agent.js'),
      loaded: true,
      exports: function ObsidianOrganizer() {
        return { startWatcher: mock.fn(() => {}) };
      },
    };
  });

  after(() => {
    if (origObsidian) require.cache[require.resolve('../agent/obsidian-agent.js')] = origObsidian;
  });

  it('returns telegramBot (gateway handle) and board', async () => {
    const board = makeBoard();
    const spawn = makeSpawn();
    const result = await startOctivia({ board, spawn });
    assert.ok(result.telegramBot, 'telegramBot (gateway handle) should exist');
    assert.ok(result.board, 'board should exist');
  });

  it('spawns openclaw gateway process', async () => {
    const board = makeBoard();
    const spawn = makeSpawn();
    await startOctivia({ board, spawn });
    assert.strictEqual(spawn.mock.calls.length, 1, 'spawn should be called once');
    const [cmd, args] = spawn.mock.calls[0].arguments;
    assert.strictEqual(cmd, 'openclaw', 'should spawn openclaw');
    assert.ok(args.includes('gateway'), 'should include gateway command');
  });

  it('does not call board.connect when board is injected', async () => {
    const board = makeBoard();
    const spawn = makeSpawn();
    await startOctivia({ board, spawn });
    assert.strictEqual(board.connect.mock.calls.length, 0, 'should not call connect on injected board');
  });

  it('gateway handle has startPolling and client.stopPolling', async () => {
    const board = makeBoard();
    const spawn = makeSpawn();
    const result = await startOctivia({ board, spawn });
    assert.ok(typeof result.telegramBot.startPolling === 'function', 'should have startPolling');
    assert.ok(typeof result.telegramBot.client?.stopPolling === 'function', 'should have client.stopPolling');
  });

  it('returns obsidianAgent (may be null if watcher fails)', async () => {
    const board = makeBoard();
    const spawn = makeSpawn();
    const result = await startOctivia({ board, spawn });
    assert.ok('obsidianAgent' in result, 'result should have obsidianAgent key');
  });
});
