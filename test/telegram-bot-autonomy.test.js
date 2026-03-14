// test/telegram-bot-autonomy.test.js — Unit tests for OctiviaAutonomy module
// Covers: onMessage, _autoSync, _detectPatterns, getContextRecap, destroy
const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const OctiviaAutonomy = require('../agent/telegram-bot-autonomy');

// ── Factories ────────────────────────────────────────────────
const makeBoard = (overrides = {}) => ({
  publish: mock.fn(async () => {}),
  ...overrides,
});

const makeReflexion = (response = 'Themes: testing\nDecisions: none\nActions: write tests') => ({
  callLLM: mock.fn(async () => response),
});

const makeSession = (noteCount = 0) => {
  const notes = [];
  for (let i = 0; i < noteCount; i++) {
    notes.push({
      author: `user${i % 3}`,
      text: `message ${i}`,
      ts: Date.now() - (noteCount - i) * 1000,
      type: 'group',
    });
  }
  return { stage: 0, notes };
};

const makeAutonomy = (opts = {}) => {
  const board = makeBoard(opts.boardOverrides);
  const reflexion = opts.noReflexion ? null : makeReflexion(opts.llmResponse);
  const context = opts.context || null;
  const autonomy = new OctiviaAutonomy({
    board,
    reflexion,
    context,
    options: opts.options || {},
  });
  return { autonomy, board, reflexion };
};

// ── FS mock helpers ──────────────────────────────────────────
let writeFileMock, mkdirMock;

function setupFsMocks() {
  writeFileMock = mock.method(fs.promises, 'writeFile', async () => {});
  mkdirMock = mock.method(fs.promises, 'mkdir', async () => {});
}

function restoreFsMocks() {
  writeFileMock?.mock.restore();
  mkdirMock?.mock.restore();
}

// ── onMessage() ──────────────────────────────────────────────
describe('OctiviaAutonomy — onMessage()', () => {
  beforeEach(() => setupFsMocks());
  afterEach(() => restoreFsMocks());

  it('increments counter on each call', async () => {
    const { autonomy } = makeAutonomy();
    const session = makeSession(5);
    await autonomy.onMessage(111, session);
    await autonomy.onMessage(111, session);
    await autonomy.onMessage(111, session);
    const counter = autonomy._getCounter(111);
    assert.strictEqual(counter.sinceSync, 3);
  });

  it('fires auto-sync at threshold (default 10)', async () => {
    const { autonomy, board } = makeAutonomy();
    const session = makeSession(15);
    for (let i = 0; i < 10; i++) {
      await autonomy.onMessage(222, session);
    }
    const syncCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:auto-sync'
    );
    assert.strictEqual(syncCalls.length, 1, 'auto-sync should fire once at threshold');
  });

  it('does NOT fire auto-sync below threshold', async () => {
    const { autonomy, board } = makeAutonomy();
    const session = makeSession(5);
    for (let i = 0; i < 9; i++) {
      await autonomy.onMessage(333, session);
    }
    const syncCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:auto-sync'
    );
    assert.strictEqual(syncCalls.length, 0, 'auto-sync should not fire below threshold');
  });

  it('busy guard prevents concurrent auto-sync', async () => {
    const slowPublish = mock.fn(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    const { autonomy } = makeAutonomy({
      boardOverrides: { publish: slowPublish },
    });
    const session = makeSession(15);

    // Fire 10 messages rapidly (don't await individually)
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(autonomy.onMessage(444, session));
    }
    await Promise.all(promises);

    // Should only sync once despite concurrent calls
    const syncCalls = slowPublish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:auto-sync'
    );
    assert.ok(syncCalls.length <= 1, 'busy guard should prevent concurrent syncs');
  });

  it('fires pattern detection at threshold (default 20)', async () => {
    const { autonomy, board } = makeAutonomy();
    const session = makeSession(25);
    for (let i = 0; i < 20; i++) {
      await autonomy.onMessage(555, session);
    }
    const digestCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:digest'
    );
    assert.strictEqual(digestCalls.length, 1, 'pattern detection should fire at threshold');
  });

  it('skips pattern detection when no reflexion', async () => {
    const { autonomy, board } = makeAutonomy({ noReflexion: true });
    const session = makeSession(25);
    for (let i = 0; i < 20; i++) {
      await autonomy.onMessage(666, session);
    }
    const digestCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:digest'
    );
    assert.strictEqual(digestCalls.length, 0, 'no digest without reflexion');
  });

  it('resets sinceSync counter after auto-sync fires', async () => {
    const { autonomy } = makeAutonomy();
    const session = makeSession(15);
    for (let i = 0; i < 10; i++) {
      await autonomy.onMessage(777, session);
    }
    const counter = autonomy._getCounter(777);
    assert.strictEqual(counter.sinceSync, 0, 'counter should reset after sync');
  });

  it('respects custom threshold from options', async () => {
    const { autonomy, board } = makeAutonomy({ options: { autoSyncThreshold: 3 } });
    const session = makeSession(5);
    for (let i = 0; i < 3; i++) {
      await autonomy.onMessage(888, session);
    }
    const syncCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:auto-sync'
    );
    assert.strictEqual(syncCalls.length, 1, 'custom threshold should be respected');
  });
});

// ── _autoSync() ──────────────────────────────────────────────
describe('OctiviaAutonomy — _autoSync()', () => {
  beforeEach(() => setupFsMocks());
  afterEach(() => restoreFsMocks());

  it('writes markdown file to vault', async () => {
    const { autonomy } = makeAutonomy();
    const session = makeSession(5);
    await autonomy._autoSync(111, session);
    assert.ok(mkdirMock.mock.calls.length >= 1, 'should mkdir');
    assert.ok(writeFileMock.mock.calls.length >= 1, 'should write file');
    const writtenContent = writeFileMock.mock.calls[0].arguments[1];
    assert.ok(writtenContent.includes('auto-sync'), 'content should indicate auto-sync');
  });

  it('publishes octivia:auto-sync to Blackboard', async () => {
    const { autonomy, board } = makeAutonomy();
    const session = makeSession(5);
    await autonomy._autoSync(222, session);
    const syncCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:auto-sync'
    );
    assert.strictEqual(syncCalls.length, 1);
    const payload = syncCalls[0].arguments[1];
    assert.strictEqual(payload.chatId, 222);
    assert.ok(payload.messageCount > 0);
    assert.ok(payload.timestamp);
  });

  it('chains notebook:task publish', async () => {
    const { autonomy, board } = makeAutonomy();
    const session = makeSession(5);
    await autonomy._autoSync(333, session);
    const notebookCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'notebook:task'
    );
    assert.strictEqual(notebookCalls.length, 1);
    const payload = notebookCalls[0].arguments[1];
    assert.strictEqual(payload.action, 'upload_source');
    assert.ok(payload.path);
  });

  it('does not throw on file write error', async () => {
    restoreFsMocks();
    writeFileMock = mock.method(fs.promises, 'writeFile', async () => {
      throw new Error('disk full');
    });
    mkdirMock = mock.method(fs.promises, 'mkdir', async () => {});
    const { autonomy } = makeAutonomy();
    const session = makeSession(5);
    // Should not throw
    await autonomy._autoSync(444, session);
  });
});

// ── _detectPatterns() ────────────────────────────────────────
describe('OctiviaAutonomy — _detectPatterns()', () => {
  beforeEach(() => setupFsMocks());
  afterEach(() => restoreFsMocks());

  it('calls reflexion.callLLM with last notes', async () => {
    const { autonomy, reflexion } = makeAutonomy();
    const session = makeSession(25);
    await autonomy._detectPatterns(111, session);
    assert.strictEqual(reflexion.callLLM.mock.calls.length, 1);
    const prompt = reflexion.callLLM.mock.calls[0].arguments[0];
    assert.ok(prompt.includes('message'), 'prompt should contain message content');
  });

  it('writes digest to vault/02-GroupChat/digests/', async () => {
    const { autonomy } = makeAutonomy();
    const session = makeSession(25);
    await autonomy._detectPatterns(222, session);
    assert.ok(writeFileMock.mock.calls.length >= 1, 'should write digest file');
    const writePath = writeFileMock.mock.calls[0].arguments[0];
    assert.ok(writePath.includes('digests'), 'path should contain digests directory');
  });

  it('publishes octivia:digest to Blackboard', async () => {
    const { autonomy, board } = makeAutonomy();
    const session = makeSession(25);
    await autonomy._detectPatterns(333, session);
    const digestCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:digest'
    );
    assert.strictEqual(digestCalls.length, 1);
    const payload = digestCalls[0].arguments[1];
    assert.strictEqual(payload.chatId, 333);
    assert.ok(payload.timestamp);
  });

  it('does not throw when reflexion fails', async () => {
    const { autonomy } = makeAutonomy();
    autonomy.reflexion = { callLLM: mock.fn(async () => { throw new Error('LLM down'); }) };
    const session = makeSession(25);
    // Should not throw
    await autonomy._detectPatterns(444, session);
  });
});

// ── getContextRecap() ────────────────────────────────────────
describe('OctiviaAutonomy — getContextRecap()', () => {
  it('returns null when counter below threshold', () => {
    const { autonomy } = makeAutonomy();
    const session = makeSession(5);
    const result = autonomy.getContextRecap(111, session);
    assert.strictEqual(result, null);
  });

  it('returns brief string when counter at/above threshold', () => {
    const { autonomy } = makeAutonomy({ options: { contextRecapThreshold: 3 } });
    const session = makeSession(15);
    // Manually set counter above threshold
    autonomy._getCounter(222).sinceSummary = 5;
    const result = autonomy.getContextRecap(222, session);
    assert.notStrictEqual(result, null, 'should return recap');
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.length > 0, 'recap should not be empty');
  });

  it('returns string under 200 chars', () => {
    const { autonomy } = makeAutonomy({ options: { contextRecapThreshold: 2 } });
    const session = makeSession(10);
    autonomy._getCounter(333).sinceSummary = 5;
    const result = autonomy.getContextRecap(333, session);
    assert.notStrictEqual(result, null);
    assert.ok(result.length <= 200, `recap too long: ${result.length} chars`);
  });

  it('works without context object and returns a non-empty string', () => {
    const { autonomy } = makeAutonomy({ options: { contextRecapThreshold: 0 } });
    const session = makeSession(5);
    autonomy._getCounter(444).sinceSummary = 15;
    const result = autonomy.getContextRecap(444, session);
    assert.strictEqual(typeof result, 'string', 'should return string with notes present');
    assert.ok(result.length > 0, 'recap should not be empty');
    assert.ok(result.includes('recent msgs'), 'recap should contain summary pattern');
  });

  it('returns null for empty session notes even with high counter', () => {
    const { autonomy } = makeAutonomy({ options: { contextRecapThreshold: 1 } });
    const session = { stage: 0, notes: [] };
    autonomy._getCounter(555).sinceSummary = 100;
    const result = autonomy.getContextRecap(555, session);
    assert.strictEqual(result, null, 'empty notes should return null');
  });

  it('handles non-array notes defensively', () => {
    const { autonomy } = makeAutonomy({ options: { contextRecapThreshold: 0 } });
    const session = { stage: 0, notes: 'not an array' };
    autonomy._getCounter(666).sinceSummary = 50;
    const result = autonomy.getContextRecap(666, session);
    assert.strictEqual(result, null, 'non-array notes should return null');
  });
});

// ── destroy() ────────────────────────────────────────────────
describe('OctiviaAutonomy — destroy()', () => {
  beforeEach(() => setupFsMocks());
  afterEach(() => restoreFsMocks());

  it('clears all Maps and Sets', async () => {
    const { autonomy } = makeAutonomy();
    const session = makeSession(5);
    await autonomy.onMessage(111, session);
    await autonomy.onMessage(222, session);
    assert.ok(autonomy._counters.size > 0, 'should have counters');

    autonomy.destroy();

    assert.strictEqual(autonomy._counters.size, 0, 'counters cleared');
    assert.strictEqual(autonomy._busy.size, 0, 'busy set cleared');
    assert.strictEqual(autonomy._lastSync.size, 0, 'lastSync cleared');
  });
});

// ── Constructor ──────────────────────────────────────────────
describe('OctiviaAutonomy — constructor()', () => {
  it('accepts board and stores it', () => {
    const board = makeBoard();
    const autonomy = new OctiviaAutonomy({ board });
    assert.strictEqual(autonomy.board, board);
  });

  it('uses default thresholds from timeouts.js when no options', () => {
    const autonomy = new OctiviaAutonomy({ board: makeBoard() });
    assert.strictEqual(typeof autonomy._syncThreshold, 'number');
    assert.ok(autonomy._syncThreshold > 0);
  });

  it('allows threshold override via options', () => {
    const autonomy = new OctiviaAutonomy({
      board: makeBoard(),
      options: { autoSyncThreshold: 5 },
    });
    assert.strictEqual(autonomy._syncThreshold, 5);
  });
});

// ── pruneStale() ─────────────────────────────────────────────
describe('OctiviaAutonomy — pruneStale()', () => {
  it('removes entries older than maxAge', () => {
    const { autonomy } = makeAutonomy();
    // Simulate old sync
    autonomy._lastSync.set(111, Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    autonomy._counters.set(111, { sinceSync: 5, sinceSummary: 3 });
    // Simulate recent sync
    autonomy._lastSync.set(222, Date.now() - 1000); // 1 second ago
    autonomy._counters.set(222, { sinceSync: 1, sinceSummary: 1 });

    autonomy.pruneStale(24 * 60 * 60 * 1000); // prune > 24h

    assert.ok(!autonomy._lastSync.has(111), 'old entry should be pruned');
    assert.ok(!autonomy._counters.has(111), 'old counter should be pruned');
    assert.ok(autonomy._lastSync.has(222), 'recent entry should remain');
    assert.ok(autonomy._counters.has(222), 'recent counter should remain');
  });

  it('does not crash on empty Maps', () => {
    const { autonomy } = makeAutonomy();
    autonomy.pruneStale();
    assert.strictEqual(autonomy._counters.size, 0);
  });
});

// ── Pattern detection busy guard ─────────────────────────────
describe('OctiviaAutonomy — pattern detection concurrency', () => {
  beforeEach(() => setupFsMocks());
  afterEach(() => restoreFsMocks());

  it('prevents concurrent pattern detection for same chatId', async () => {
    const slowLLM = mock.fn(async () => {
      await new Promise(r => setTimeout(r, 50));
      return 'Themes: test';
    });
    const { autonomy, board } = makeAutonomy({
      options: { autoSyncThreshold: 999, patternDetectThreshold: 3 },
    });
    autonomy.reflexion = { callLLM: slowLLM };

    const session = makeSession(10);
    // Send 3 messages concurrently (hitting threshold)
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(autonomy.onMessage(999, session));
    }
    await Promise.all(promises);

    const digestCalls = board.publish.mock.calls.filter(
      c => c.arguments[0] === 'octivia:digest'
    );
    assert.ok(digestCalls.length <= 1, 'busy guard should prevent concurrent pattern detection');
  });
});
