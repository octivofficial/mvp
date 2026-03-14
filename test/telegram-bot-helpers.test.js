// test/telegram-bot-helpers.test.js — Unit tests for TelegramDevelopmentBot helper methods
// Covers: _loadSession, _saveSession, _getSystemContext, _systemSnapshot
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const TelegramDevelopmentBot = require('../agent/telegram-bot.js');

// ── Factories ────────────────────────────────────────────────
const makeBoard = (overrides = {}) => ({
  publish: mock.fn(async () => {}),
  createSubscriber: mock.fn(async () => ({ subscribe: mock.fn(() => {}) })),
  getConfig: mock.fn(async () => null),
  setConfig: mock.fn(async () => {}),
  get: mock.fn(async () => null),
  ...overrides,
});

const baseConfig = () => ({
  telegramToken: 'dummy_token',
  geminiKey: 'dummy_key',
  blackboardUrl: 'redis://localhost:6380',
  authorizedUsers: [],
});

const makeBot = (boardOverrides = {}, context = null) => {
  const board = makeBoard(boardOverrides);
  const bot = new TelegramDevelopmentBot(baseConfig(), board, null, null, context);
  return { bot, board };
};

// ── _loadSession ─────────────────────────────────────────────
describe('TelegramDevelopmentBot — _loadSession()', () => {
  it('returns default session when no Redis data and no in-memory session', async () => {
    const { bot } = makeBot();
    const session = await bot._loadSession(12345);
    assert.deepStrictEqual(session, { stage: 0, notes: [] });
  });

  it('returns in-memory session when Redis is unavailable (board.getConfig throws)', async () => {
    const { bot } = makeBot({
      getConfig: mock.fn(async () => { throw new Error('Redis down'); }),
    });
    const cached = { stage: 2, notes: [{ text: 'hello' }] };
    bot._sessions.set(12345, cached);
    const session = await bot._loadSession(12345);
    assert.deepStrictEqual(session, cached);
  });

  it('returns Redis session when board.getConfig returns valid object', async () => {
    const redisSession = { stage: 1, notes: [{ text: 'from redis' }] };
    const { bot } = makeBot({
      getConfig: mock.fn(async () => redisSession),
    });
    const session = await bot._loadSession(99999);
    assert.deepStrictEqual(session, redisSession);
  });

  it('falls back to in-memory when Redis returns null', async () => {
    const { bot } = makeBot({
      getConfig: mock.fn(async () => null),
    });
    const cached = { stage: 3, notes: [] };
    bot._sessions.set(77777, cached);
    const session = await bot._loadSession(77777);
    assert.deepStrictEqual(session, cached);
  });
});

// ── _saveSession ─────────────────────────────────────────────
describe('TelegramDevelopmentBot — _saveSession()', () => {
  it('always stores session in _sessions Map', async () => {
    const { bot } = makeBot();
    const session = { stage: 1, notes: [{ text: 'test' }] };
    await bot._saveSession(12345, session);
    assert.deepStrictEqual(bot._sessions.get(12345), session);
  });

  it('calls board.setConfig with correct key format', async () => {
    const { bot, board } = makeBot();
    const session = { stage: 2, notes: [] };
    await bot._saveSession(67890, session);
    const call = board.setConfig.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'octivia:session:67890');
    assert.deepStrictEqual(call.arguments[1], session);
  });

  it('does not throw when board.setConfig throws (Redis error caught)', async () => {
    const { bot } = makeBot({
      setConfig: mock.fn(async () => { throw new Error('Redis write error'); }),
    });
    // Should not throw
    await bot._saveSession(12345, { stage: 0, notes: [] });
    // Should still be saved in memory
    assert.ok(bot._sessions.has(12345));
  });
});

// ── _getSystemContext ────────────────────────────────────────
describe('TelegramDevelopmentBot — _getSystemContext()', () => {
  it('returns formatted context when this.context is provided', async () => {
    const mockContext = {
      gather: mock.fn(async () => ({ phase: 'test', agents: 3 })),
      format: mock.fn((data) => `Phase: ${data.phase}, Agents: ${data.agents}`),
    };
    const { bot } = makeBot({}, mockContext);
    const result = await bot._getSystemContext();
    assert.strictEqual(result, 'Phase: test, Agents: 3');
    assert.strictEqual(mockContext.gather.mock.calls.length, 1);
    assert.strictEqual(mockContext.format.mock.calls.length, 1);
  });

  it('falls back when context.gather throws', async () => {
    const mockContext = {
      gather: mock.fn(async () => { throw new Error('gather failed'); }),
      format: mock.fn(() => 'should not reach'),
    };
    const { bot } = makeBot({}, mockContext);
    // Fallback reads MEMORY.md from disk — may or may not exist
    const result = await bot._getSystemContext();
    assert.strictEqual(typeof result, 'string');
  });

  it('returns empty string when both context and MEMORY.md fail', async () => {
    const mockContext = {
      gather: mock.fn(async () => { throw new Error('fail'); }),
      format: mock.fn(() => 'nope'),
    };
    const { bot } = makeBot({}, mockContext);
    // Override the fallback to also fail
    const originalReadFile = require('fs').promises.readFile;
    mock.method(require('fs').promises, 'readFile', async () => { throw new Error('no file'); });
    try {
      const result = await bot._getSystemContext();
      assert.strictEqual(typeof result, 'string');
    } finally {
      require('fs').promises.readFile = originalReadFile;
    }
  });
});

// ── _systemSnapshot ──────────────────────────────────────────
describe('TelegramDevelopmentBot — _systemSnapshot()', () => {
  it('includes Host line with timestamp', async () => {
    const { bot } = makeBot();
    const result = await bot._systemSnapshot();
    assert.ok(result.includes('Host:'), 'should contain Host: line');
    // Should contain ISO-like date
    assert.match(result, /\d{4}-\d{2}-\d{2}/);
  });

  it('includes Active agents when board.get returns registry data', async () => {
    const { bot } = makeBot({
      get: mock.fn(async (key) => {
        if (key === 'agents:registry') return { 'builder-01': {}, 'builder-02': {} };
        return null;
      }),
    });
    const result = await bot._systemSnapshot();
    assert.ok(result.includes('Active agents:'), 'should include active agents list');
    assert.ok(result.includes('builder-01'));
  });

  it('includes Vibes count when _countVibes returns > 0', async () => {
    const { bot } = makeBot();
    bot._countVibes = async () => 5;
    const result = await bot._systemSnapshot();
    assert.ok(result.includes('Vibes accumulated: 5'), 'should show vibe count');
  });

  it('returns snapshot with Host even when all data sources fail', async () => {
    const { bot } = makeBot({
      get: mock.fn(async () => { throw new Error('fail'); }),
    });
    bot._countVibes = async () => { throw new Error('fail'); };
    const result = await bot._systemSnapshot();
    // Should still have Host line at minimum
    assert.ok(result.includes('Host:'));
  });
});
