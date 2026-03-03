/**
 * Blackboard Integration Test — Uses real Redis (port 6380)
 * Usage: node --test test/blackboard.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Blackboard } = require('../agent/blackboard');

describe('Blackboard — Redis Integration', () => {
  let board;

  before(async () => {
    board = new Blackboard();
    await board.connect();
    // Cleanup previous test keys before running tests
    const client = board.client;
    const keys = await client.keys('octiv:test:*');
    if (keys.length > 0) {
      await client.del(keys);
    }
  });

  after(async () => {
    // Cleanup test keys after tests
    const client = board.client;
    const keys = await client.keys('octiv:test:*');
    if (keys.length > 0) {
      await client.del(keys);
    }
    await board.disconnect();
  });

  it('Should successfully connect to Redis', () => {
    assert.ok(board.client.isReady, 'Redis client should be ready');
  });

  it('Should support publish -> get roundtrip', async () => {
    const testData = {
      status: 'spawned',
      position: { x: 10, y: 64, z: -20 },
      health: 20,
      food: 20,
    };

    await board.publish('test:roundtrip', testData);
    const result = await board.get('test:roundtrip');

    assert.ok(result, 'Published data should be retrievable');
    assert.equal(result.status, 'spawned');
    assert.deepStrictEqual(result.position, { x: 10, y: 64, z: -20 });
    assert.equal(result.health, 20);
    assert.ok(result.ts, 'Timestamp should be included');
  });

  it('Should set TTL on :latest keys (300s)', async () => {
    await board.publish('test:ttl', { check: true });

    const ttl = await board.client.ttl('octiv:test:ttl:latest');
    assert.ok(ttl > 0, `TTL should be positive, got: ${ttl}`);
    assert.ok(ttl <= 300, `TTL should be <= 300, got: ${ttl}`);
  });

  it('Should return null for non-existent channels', async () => {
    const result = await board.get('test:nonexistent_channel_xyz');
    assert.equal(result, null, 'Non-existent channel should return null');
  });

  it('Should manage AC progress correctly', async () => {
    await board.updateAC('test-bot', 1, 'in_progress');
    await board.updateAC('test-bot', 2, 'done');

    const progress = await board.getACProgress('test-bot');
    assert.ok(progress['AC-1'], 'AC-1 should exist');
    assert.ok(progress['AC-2'], 'AC-2 should exist');

    const ac1 = JSON.parse(progress['AC-1']);
    assert.equal(ac1.status, 'in_progress');

    const ac2 = JSON.parse(progress['AC-2']);
    assert.equal(ac2.status, 'done');
  });

  it('Should maintain a maximum of 50 reflexion logs', async () => {
    // Generate 55 logs
    for (let i = 0; i < 55; i++) {
      await board.logReflexion('test-bot', { error: `test-error-${i}`, iteration: i });
    }

    const logs = await board.client.lRange('octiv:agent:test-bot:reflexion', 0, -1);
    assert.ok(logs.length <= 50, `Should keep max 50, got: ${logs.length}`);
  });
});
