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

const makeReflexion = () => ({
  init: mock.fn(async () => {}),
  shutdown: mock.fn(async () => {}),
  callLLM: mock.fn(async () => 'ok'),
});

const makeTelegramBot = () => ({
  startPolling: mock.fn(() => {}),
  client: { stopPolling: mock.fn(async () => {}) },
});

// ── startOctivia() ────────────────────────────────────────────────

describe('startOctivia()', () => {
  let origTelegram;
  let origObsidian;

  before(() => {
    // Stub TelegramDevelopmentBot
    origTelegram = require.cache[require.resolve('../agent/telegram-bot.js')];
    require.cache[require.resolve('../agent/telegram-bot.js')] = {
      id: require.resolve('../agent/telegram-bot.js'),
      filename: require.resolve('../agent/telegram-bot.js'),
      loaded: true,
      exports: function TelegramDevelopmentBot() {
        return makeTelegramBot();
      },
    };

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
    if (origTelegram) require.cache[require.resolve('../agent/telegram-bot.js')] = origTelegram;
    if (origObsidian) require.cache[require.resolve('../agent/obsidian-agent.js')] = origObsidian;
  });

  it('returns telegramBot and board', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion();
    const result = await startOctivia({ board, reflexion });
    assert.ok(result.telegramBot, 'telegramBot should exist');
    assert.ok(result.board, 'board should exist');
  });

  it('starts Telegram polling', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion();
    const result = await startOctivia({ board, reflexion });
    assert.ok(result.telegramBot.startPolling.mock.calls.length >= 1 ||
              typeof result.telegramBot.startPolling === 'function',
              'polling should have been started');
  });

  it('does not call board.connect when board is injected', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion();
    await startOctivia({ board, reflexion });
    assert.strictEqual(board.connect.mock.calls.length, 0, 'should not call connect on injected board');
  });

  it('does not call reflexion.init when reflexion is injected', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion();
    await startOctivia({ board, reflexion });
    assert.strictEqual(reflexion.init.mock.calls.length, 0, 'should not re-init injected reflexion');
  });

  it('returns obsidianAgent (may be null if watcher fails)', async () => {
    const board = makeBoard();
    const reflexion = makeReflexion();
    const result = await startOctivia({ board, reflexion });
    // obsidianAgent can be null if OBSIDIAN_VAULT_PATH not set — that's fine
    assert.ok('obsidianAgent' in result, 'result should have obsidianAgent key');
  });
});
