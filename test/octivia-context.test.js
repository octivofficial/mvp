const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert');
const OctiviaContext = require('../agent/octivia-context.js');

// ── Helpers ──────────────────────────────────────────────────────

const makeBoard = (registry = {}) => ({
  getHash: mock.fn(async () => registry),
  getConfig: mock.fn(async () => null),
  setConfig: mock.fn(async () => {}),
});

// ── Constructor ──────────────────────────────────────────────────

describe('OctiviaContext constructor', () => {
  it('creates instance without board', () => {
    const ctx = new OctiviaContext();
    assert.ok(ctx);
    assert.strictEqual(ctx.board, null);
  });

  it('stores board reference when provided', () => {
    const board = makeBoard();
    const ctx = new OctiviaContext(board);
    assert.strictEqual(ctx.board, board);
  });

  it('starts with no cache', () => {
    const ctx = new OctiviaContext();
    assert.strictEqual(ctx._cache, null);
    assert.strictEqual(ctx._cacheTs, 0);
  });
});

// ── gather() ─────────────────────────────────────────────────────

describe('OctiviaContext gather()', () => {
  it('returns object with required keys', async () => {
    const ctx = new OctiviaContext();
    const result = await ctx.gather();
    assert.ok(typeof result === 'object');
    assert.ok('memory' in result);
    assert.ok('recentCommits' in result);
    assert.ok('agents' in result);
    assert.ok('previousVibes' in result);
    assert.ok('ts' in result);
  });

  it('caches result within TTL', async () => {
    const ctx = new OctiviaContext();
    const r1 = await ctx.gather();
    const r2 = await ctx.gather();
    assert.strictEqual(r1, r2); // same reference
  });

  it('refreshes cache after TTL expires', async () => {
    const ctx = new OctiviaContext();
    const r1 = await ctx.gather();
    // Manually expire cache
    ctx._cacheTs = Date.now() - 61_000;
    const r2 = await ctx.gather();
    assert.notStrictEqual(r1, r2); // new object
  });

  it('includes timestamp in result', async () => {
    const ctx = new OctiviaContext();
    const result = await ctx.gather();
    assert.ok(typeof result.ts === 'number');
    assert.ok(result.ts <= Date.now());
  });

  it('populates agents from board.getHash', async () => {
    const board = makeBoard({ 'bot1': '{}', 'bot2': '{}' });
    const ctx = new OctiviaContext(board);
    const result = await ctx.gather();
    assert.deepStrictEqual(result.agents, { 'bot1': '{}', 'bot2': '{}' });
    assert.strictEqual(board.getHash.mock.calls.length, 1);
  });

  it('returns empty agents when no board', async () => {
    const ctx = new OctiviaContext(null);
    const result = await ctx.gather();
    assert.deepStrictEqual(result.agents, {});
  });

  it('returns empty agents when board.getHash throws', async () => {
    const board = { getHash: async () => { throw new Error('Redis down'); } };
    const ctx = new OctiviaContext(board);
    const result = await ctx.gather();
    assert.deepStrictEqual(result.agents, {});
  });
});

// ── format() ─────────────────────────────────────────────────────

describe('OctiviaContext format()', () => {
  it('returns string from gathered context', async () => {
    const ctx = new OctiviaContext();
    const data = await ctx.gather();
    const formatted = ctx.format(data);
    assert.ok(typeof formatted === 'string');
  });

  it('returns empty string for null input', () => {
    const ctx = new OctiviaContext();
    const result = ctx.format(null);
    assert.strictEqual(result, '');
  });

  it('returns string for empty input object', () => {
    const ctx = new OctiviaContext();
    const result = ctx.format({});
    assert.ok(typeof result === 'string');
  });

  it('includes agent names when agents provided', () => {
    const ctx = new OctiviaContext();
    const result = ctx.format({ agents: { 'miner': '{}', 'farmer': '{}' } });
    assert.ok(result.includes('miner'));
    assert.ok(result.includes('farmer'));
  });

  it('includes recent commits when provided', () => {
    const ctx = new OctiviaContext();
    const result = ctx.format({ recentCommits: 'abc123 fix: something' });
    assert.ok(result.includes('abc123'));
  });

  it('includes previous vibes when provided', () => {
    const ctx = new OctiviaContext();
    const result = ctx.format({ previousVibes: '- 2026-01-01: "Build a thing"' });
    assert.ok(result.includes('Build a thing'));
  });

  it('does not throw on partial data', () => {
    const ctx = new OctiviaContext();
    assert.doesNotThrow(() => ctx.format({ memory: 'some memory', agents: {} }));
    assert.doesNotThrow(() => ctx.format({ recentCommits: '', previousVibes: '' }));
  });
});

// ── _gitLog() ────────────────────────────────────────────────────

describe('OctiviaContext _gitLog()', () => {
  it('returns a string', () => {
    const ctx = new OctiviaContext();
    const result = ctx._gitLog();
    assert.ok(typeof result === 'string');
  });

  it('returns non-empty string in a git repo', () => {
    const ctx = new OctiviaContext();
    const result = ctx._gitLog();
    // In this git repo, there should be commits
    assert.ok(result.length > 0);
  });
});
