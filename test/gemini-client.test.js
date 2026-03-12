/**
 * GeminiClient Tests — TDD Red-Green-Refactor (Phase 7)
 * Requirements (Requirement 8):
 *   - constructor stores board, apiKey, dailyLimitUsd, costPerCallUsd, httpClient
 *   - constructor initializes dailyCostUsd = 0
 *   - ask() calls httpClient.post(question), returns response string
 *   - ask() increments dailyCostUsd by costPerCallUsd on success
 *   - ask() throws 'Daily limit exceeded' before calling when limit would be exceeded
 *   - trackCost(amount) increments dailyCostUsd, returns new total
 *   - checkLimit() returns true when under limit, false when at or over limit
 *   - getDailyCost() returns current dailyCostUsd
 *   - resetDailyCost() resets dailyCostUsd to 0
 *   - resetDailyCost() publishes to board channel 'gemini:daily:reset' with author
 *
 * Usage: node --test test/gemini-client.test.js
 */
'use strict';

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { GeminiClient } = require('../agent/gemini-client');

// ── Mock helpers ────────────────────────────────────────────────────

/**
 * Build a mock httpClient with configurable post() response.
 * @param {string} [response='answer'] - the string to return from post()
 */
const makeHttpClient = (response = 'answer') => ({
  post: mock.fn(async () => response),
});

/**
 * Build a mock Blackboard with observable publish().
 */
const makeBoard = () => ({
  publish: mock.fn(async () => {}),
});

// ── constructor ──────────────────────────────────────────────────────

describe('GeminiClient — constructor', () => {
  it('should store the provided apiKey', () => {
    const client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'test-key-123',
      httpClient: makeHttpClient(),
    });
    assert.equal(client.apiKey, 'test-key-123', 'apiKey should be stored');
  });

  it('should use default dailyLimitUsd of 1.00', () => {
    const client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      httpClient: makeHttpClient(),
    });
    assert.equal(client.dailyLimitUsd, 1.00, 'default dailyLimitUsd should be 1.00');
  });

  it('should store a custom dailyLimitUsd when provided', () => {
    const client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      dailyLimitUsd: 5.00,
      httpClient: makeHttpClient(),
    });
    assert.equal(client.dailyLimitUsd, 5.00, 'custom dailyLimitUsd should be stored');
  });

  it('should use default costPerCallUsd of 0.0001', () => {
    const client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      httpClient: makeHttpClient(),
    });
    assert.equal(client.costPerCallUsd, 0.0001, 'default costPerCallUsd should be 0.0001');
  });

  it('should store a custom costPerCallUsd when provided', () => {
    const client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      costPerCallUsd: 0.001,
      httpClient: makeHttpClient(),
    });
    assert.equal(client.costPerCallUsd, 0.001, 'custom costPerCallUsd should be stored');
  });

  it('should initialize dailyCostUsd to 0', () => {
    const client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      httpClient: makeHttpClient(),
    });
    assert.equal(client.dailyCostUsd, 0, 'dailyCostUsd should start at 0');
  });

  it('should store the injected board', () => {
    const board = makeBoard();
    const client = new GeminiClient({ board, apiKey: 'k', httpClient: makeHttpClient() });
    assert.strictEqual(client.board, board, 'board should be stored');
  });

  it('should store the injected httpClient', () => {
    const httpClient = makeHttpClient();
    const client = new GeminiClient({ board: makeBoard(), apiKey: 'k', httpClient });
    assert.strictEqual(client.httpClient, httpClient, 'httpClient should be stored');
  });
});

// ── ask() ────────────────────────────────────────────────────────────

describe('GeminiClient — ask()', () => {
  let client, httpClient, board;

  beforeEach(() => {
    board = makeBoard();
    httpClient = makeHttpClient('Hello from Gemini');
    client = new GeminiClient({
      board,
      apiKey: 'test-key',
      dailyLimitUsd: 1.00,
      costPerCallUsd: 0.0001,
      httpClient,
    });
  });

  it('should call httpClient.post with the provided question', async () => {
    await client.ask('What is Minecraft?');
    assert.equal(httpClient.post.mock.calls.length, 1, 'post should be called once');
    const [question] = httpClient.post.mock.calls[0].arguments;
    assert.equal(question, 'What is Minecraft?', 'post should receive the question');
  });

  it('should return the string response from httpClient.post', async () => {
    const result = await client.ask('any question');
    assert.equal(result, 'Hello from Gemini', 'should return the response string');
  });

  it('should increment dailyCostUsd by costPerCallUsd after success', async () => {
    assert.equal(client.dailyCostUsd, 0, 'starts at 0');
    await client.ask('q1');
    assert.equal(client.dailyCostUsd, 0.0001, 'should be 0.0001 after 1 call');
  });

  it('should accumulate cost across multiple calls', async () => {
    await client.ask('q1');
    await client.ask('q2');
    await client.ask('q3');
    assert.ok(
      Math.abs(client.dailyCostUsd - 0.0003) < 1e-10,
      `expected 0.0003, got ${client.dailyCostUsd}`
    );
  });

  it('should throw "Daily limit exceeded" before calling when limit would be exceeded', async () => {
    // Set cost just at the boundary: adding costPerCallUsd would exceed
    client.dailyCostUsd = 1.00;
    await assert.rejects(
      () => client.ask('overflow question'),
      (err) => err.message === 'Daily limit exceeded'
    );
  });

  it('should not call httpClient.post when limit is already at boundary', async () => {
    client.dailyCostUsd = 1.00;
    try {
      await client.ask('overflow');
    } catch (_) {
      // expected
    }
    assert.equal(httpClient.post.mock.calls.length, 0, 'post should NOT be called when limit exceeded');
  });

  it('should throw when dailyCostUsd + costPerCallUsd exceeds dailyLimitUsd', async () => {
    // 0.9999 + 0.0001 = 1.0000 which is NOT > 1.00, so should NOT throw
    client.dailyCostUsd = 0.9999;
    const result = await client.ask('borderline');
    assert.equal(result, 'Hello from Gemini', 'should succeed at exact boundary');
  });

  it('should throw "Daily limit exceeded" when cost would exceed (0.9999 + 0.0002 > 1.00)', async () => {
    client = new GeminiClient({
      board,
      apiKey: 'test-key',
      dailyLimitUsd: 1.00,
      costPerCallUsd: 0.0002,
      httpClient,
    });
    client.dailyCostUsd = 0.9999;
    await assert.rejects(
      () => client.ask('exceed'),
      (err) => err.message === 'Daily limit exceeded'
    );
  });

  it('should re-throw errors from httpClient.post', async () => {
    httpClient.post = mock.fn(async () => { throw new Error('API network error'); });
    await assert.rejects(
      () => client.ask('q'),
      (err) => err.message === 'API network error'
    );
  });

  it('should not increment cost when httpClient.post throws', async () => {
    httpClient.post = mock.fn(async () => { throw new Error('fail'); });
    try {
      await client.ask('q');
    } catch (_) {
      // expected
    }
    assert.equal(client.dailyCostUsd, 0, 'cost should NOT be incremented on failure');
  });
});

// ── trackCost() ──────────────────────────────────────────────────────

describe('GeminiClient — trackCost()', () => {
  let client;

  beforeEach(() => {
    client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      httpClient: makeHttpClient(),
    });
  });

  it('should increment dailyCostUsd by the given amount', () => {
    client.trackCost(0.005);
    assert.ok(
      Math.abs(client.dailyCostUsd - 0.005) < 1e-12,
      `expected 0.005, got ${client.dailyCostUsd}`
    );
  });

  it('should return the new total after incrementing', () => {
    const result = client.trackCost(0.01);
    assert.ok(
      Math.abs(result - 0.01) < 1e-12,
      `expected 0.01, got ${result}`
    );
  });

  it('should accumulate costs across multiple trackCost calls', () => {
    client.trackCost(0.001);
    client.trackCost(0.002);
    const result = client.trackCost(0.003);
    assert.ok(
      Math.abs(result - 0.006) < 1e-12,
      `expected 0.006, got ${result}`
    );
  });

  it('should work with zero amount (no-op)', () => {
    const result = client.trackCost(0);
    assert.equal(result, 0, 'tracking 0 cost should return 0');
  });

  it('should handle decimal precision correctly', () => {
    client.trackCost(0.0001);
    client.trackCost(0.0001);
    const result = client.trackCost(0.0001);
    assert.ok(
      Math.abs(result - 0.0003) < 1e-12,
      `expected 0.0003, got ${result}`
    );
  });
});

// ── checkLimit() ─────────────────────────────────────────────────────

describe('GeminiClient — checkLimit()', () => {
  let client;

  beforeEach(() => {
    client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      dailyLimitUsd: 1.00,
      httpClient: makeHttpClient(),
    });
  });

  it('should return true when dailyCostUsd is 0 (well under limit)', () => {
    assert.equal(client.checkLimit(), true, 'fresh client should have limit available');
  });

  it('should return true when dailyCostUsd is below dailyLimitUsd', () => {
    client.dailyCostUsd = 0.50;
    assert.equal(client.checkLimit(), true, 'should return true when under limit');
  });

  it('should return false when dailyCostUsd equals dailyLimitUsd', () => {
    client.dailyCostUsd = 1.00;
    assert.equal(client.checkLimit(), false, 'should return false when at limit');
  });

  it('should return false when dailyCostUsd exceeds dailyLimitUsd', () => {
    client.dailyCostUsd = 1.50;
    assert.equal(client.checkLimit(), false, 'should return false when over limit');
  });

  it('should return true just below the limit', () => {
    client.dailyCostUsd = 0.9999;
    assert.equal(client.checkLimit(), true, 'should return true just below limit');
  });

  it('should respect custom dailyLimitUsd', () => {
    const customClient = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      dailyLimitUsd: 0.50,
      httpClient: makeHttpClient(),
    });
    customClient.dailyCostUsd = 0.49;
    assert.equal(customClient.checkLimit(), true, 'should be true under custom limit');
    customClient.dailyCostUsd = 0.50;
    assert.equal(customClient.checkLimit(), false, 'should be false at custom limit');
  });
});

// ── getDailyCost() ───────────────────────────────────────────────────

describe('GeminiClient — getDailyCost()', () => {
  let client;

  beforeEach(() => {
    client = new GeminiClient({
      board: makeBoard(),
      apiKey: 'k',
      httpClient: makeHttpClient(),
    });
  });

  it('should return 0 initially', () => {
    assert.equal(client.getDailyCost(), 0, 'initial cost should be 0');
  });

  it('should return the current dailyCostUsd after trackCost', () => {
    client.dailyCostUsd = 0.42;
    assert.equal(client.getDailyCost(), 0.42, 'should return stored dailyCostUsd');
  });

  it('should reflect cost after ask() calls', async () => {
    await client.ask('q1');
    const cost = client.getDailyCost();
    assert.ok(cost > 0, 'cost should be positive after ask()');
    assert.equal(cost, client.costPerCallUsd, 'should equal one costPerCallUsd');
  });

  it('should return exact value set via dailyCostUsd property', () => {
    client.dailyCostUsd = 0.1234;
    assert.equal(client.getDailyCost(), 0.1234);
  });
});

// ── resetDailyCost() ─────────────────────────────────────────────────

describe('GeminiClient — resetDailyCost()', () => {
  let client, board;

  beforeEach(() => {
    board = makeBoard();
    client = new GeminiClient({
      board,
      apiKey: 'k',
      dailyLimitUsd: 1.00,
      costPerCallUsd: 0.0001,
      httpClient: makeHttpClient(),
    });
  });

  it('should reset dailyCostUsd to 0', async () => {
    client.dailyCostUsd = 0.75;
    await client.resetDailyCost();
    assert.equal(client.dailyCostUsd, 0, 'dailyCostUsd should be reset to 0');
  });

  it('should call board.publish once', async () => {
    await client.resetDailyCost();
    assert.equal(board.publish.mock.calls.length, 1, 'board.publish should be called once');
  });

  it('should publish to channel "gemini:daily:reset"', async () => {
    await client.resetDailyCost();
    const [channel] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'gemini:daily:reset', 'should publish to correct channel');
  });

  it('should publish with author "gemini-client"', async () => {
    await client.resetDailyCost();
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.author, 'gemini-client', 'author should be "gemini-client"');
  });

  it('should publish a resetAt timestamp (number)', async () => {
    const before = Date.now();
    await client.resetDailyCost();
    const after = Date.now();
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.ok(typeof data.resetAt === 'number', 'resetAt should be a number');
    assert.ok(data.resetAt >= before && data.resetAt <= after, 'resetAt should be a recent timestamp');
  });

  it('should reset to 0 even when dailyCostUsd was already 0', async () => {
    assert.equal(client.dailyCostUsd, 0);
    await client.resetDailyCost();
    assert.equal(client.dailyCostUsd, 0, 'reset from 0 should stay at 0');
    assert.equal(board.publish.mock.calls.length, 1, 'publish should still be called');
  });

  it('should allow new ask() calls after reset when limit was reached', async () => {
    const httpClient = makeHttpClient('post-reset response');
    client = new GeminiClient({
      board,
      apiKey: 'k',
      dailyLimitUsd: 1.00,
      costPerCallUsd: 0.0001,
      httpClient,
    });
    client.dailyCostUsd = 1.00; // at limit
    await client.resetDailyCost();
    // Should now be able to call ask() again
    const result = await client.ask('after reset');
    assert.equal(result, 'post-reset response', 'should work after reset');
  });
});
