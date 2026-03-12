/**
 * PathfindingQueue Tests — TDD Red-Green-Refactor
 *
 * Requirements (Phase 4, Requirement 7):
 *   - enqueue(goal)          — adds goal to FIFO queue, returns queue length
 *   - calculateTimeout(dist) — baseTimeoutMs + (distance / 50) * 30000
 *   - calculateDistance(goal)— Euclidean distance from bot.entity.position to goal
 *   - process()              — dequeues first item, calls goto with timeout, retries on failure
 *   - processAll()           — drains queue, returns array of results
 *   - publishMetrics(metrics)— writes to board.setConfig and board.publish
 *
 * Usage: node --test test/pathfinding-queue.test.js
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { PathfindingQueue } = require('../agent/pathfinding-queue');

// ── Mock factories ────────────────────────────────────────────

function makeBot(gotoImpl) {
  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    pathfinder: { goto: mock.fn(gotoImpl || (async () => {})) },
  };
}

function makeBoard() {
  return {
    setConfig: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
  };
}

// ── constructor ───────────────────────────────────────────────

describe('PathfindingQueue — constructor', () => {
  it('should store board, bot, agentId and baseTimeoutMs from options', () => {
    const board = makeBoard();
    const bot = makeBot();
    const pq = new PathfindingQueue({ board, bot, agentId: 'builder-01', baseTimeoutMs: 20000 });

    assert.equal(pq.board, board, 'board should be stored');
    assert.equal(pq.bot, bot, 'bot should be stored');
    assert.equal(pq.agentId, 'builder-01', 'agentId should be stored');
    assert.equal(pq.baseTimeoutMs, 20000, 'baseTimeoutMs should be stored');
  });

  it('should default baseTimeoutMs to 30000 when not provided', () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    assert.equal(pq.baseTimeoutMs, 30000, 'default baseTimeoutMs should be 30000');
  });

  it('should initialize queue as empty array', () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    assert.deepEqual(pq.queue, [], 'initial queue should be empty array');
  });

  it('should initialize metrics with all counters at zero', () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    assert.deepEqual(pq.metrics, {
      totalGoals: 0,
      successCount: 0,
      failCount: 0,
      totalDistance: 0,
    }, 'initial metrics should be all zeros');
  });
});

// ── enqueue ───────────────────────────────────────────────────

describe('PathfindingQueue — enqueue', () => {
  let pq;

  beforeEach(() => {
    pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'builder-01' });
  });

  it('should add a goal to the queue and return length 1', () => {
    const len = pq.enqueue({ x: 10, y: 64, z: 20 });
    assert.equal(len, 1, 'queue length should be 1 after first enqueue');
  });

  it('should return incrementing length on successive enqueues', () => {
    pq.enqueue({ x: 1, y: 64, z: 1 });
    const len = pq.enqueue({ x: 2, y: 64, z: 2 });
    assert.equal(len, 2, 'queue length should be 2 after second enqueue');
  });

  it('should preserve FIFO order (first in, first out)', () => {
    pq.enqueue({ x: 10, y: 64, z: 0, label: 'first' });
    pq.enqueue({ x: 20, y: 64, z: 0, label: 'second' });
    pq.enqueue({ x: 30, y: 64, z: 0, label: 'third' });

    assert.equal(pq.queue[0].label, 'first', 'first enqueued item should be at index 0');
    assert.equal(pq.queue[1].label, 'second', 'second enqueued item should be at index 1');
    assert.equal(pq.queue[2].label, 'third', 'third enqueued item should be at index 2');
  });

  it('should store goal with optional label field', () => {
    pq.enqueue({ x: 5, y: 64, z: 5, label: 'shelter-door' });
    assert.equal(pq.queue[0].label, 'shelter-door', 'label field should be preserved in queue');
  });

  it('should store goal without label when not provided', () => {
    pq.enqueue({ x: 5, y: 64, z: 5 });
    assert.equal(pq.queue[0].x, 5, 'goal x should be stored');
    assert.equal(pq.queue[0].y, 64, 'goal y should be stored');
    assert.equal(pq.queue[0].z, 5, 'goal z should be stored');
  });
});

// ── calculateTimeout ──────────────────────────────────────────

describe('PathfindingQueue — calculateTimeout', () => {
  let pq;

  beforeEach(() => {
    pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01', baseTimeoutMs: 30000 });
  });

  it('should return baseTimeoutMs when distance is 0', () => {
    const timeout = pq.calculateTimeout(0);
    assert.equal(timeout, 30000, 'timeout at distance 0 should equal baseTimeoutMs');
  });

  it('should apply formula: baseTimeoutMs + (distance / 50) * 30000 at 50 blocks', () => {
    // 30000 + (50 / 50) * 30000 = 60000
    const timeout = pq.calculateTimeout(50);
    assert.equal(timeout, 60000, 'timeout at 50 blocks should be 60000ms');
  });

  it('should apply formula correctly at 100 blocks', () => {
    // 30000 + (100 / 50) * 30000 = 90000
    const timeout = pq.calculateTimeout(100);
    assert.equal(timeout, 90000, 'timeout at 100 blocks should be 90000ms');
  });

  it('should apply formula correctly at 500 blocks', () => {
    // 30000 + (500 / 50) * 30000 = 330000
    const timeout = pq.calculateTimeout(500);
    assert.equal(timeout, 330000, 'timeout at 500 blocks should be 330000ms');
  });

  it('should scale proportionally with custom baseTimeoutMs', () => {
    const pqCustom = new PathfindingQueue({
      board: makeBoard(),
      bot: makeBot(),
      agentId: 'bot-02',
      baseTimeoutMs: 10000,
    });
    // 10000 + (50 / 50) * 30000 = 40000
    const timeout = pqCustom.calculateTimeout(50);
    assert.equal(timeout, 40000, 'timeout with baseTimeoutMs=10000 at 50 blocks should be 40000ms');
  });
});

// ── calculateDistance ─────────────────────────────────────────

describe('PathfindingQueue — calculateDistance', () => {
  it('should return 0 when goal equals bot position', () => {
    const bot = makeBot();
    // bot position is (0, 64, 0)
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    const dist = pq.calculateDistance({ x: 0, y: 64, z: 0 });
    assert.equal(dist, 0, 'distance to current position should be 0');
  });

  it('should compute Euclidean distance correctly along X axis', () => {
    const bot = makeBot();
    // bot at (0, 64, 0), goal at (3, 64, 0) => sqrt(9) = 3
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    const dist = pq.calculateDistance({ x: 3, y: 64, z: 0 });
    assert.equal(dist, 3, 'distance along x-axis of 3 blocks should be 3');
  });

  it('should compute Euclidean distance in 3D space', () => {
    const bot = makeBot();
    // bot at (0, 64, 0), goal at (3, 64, 4) => sqrt(9 + 0 + 16) = sqrt(25) = 5
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    const dist = pq.calculateDistance({ x: 3, y: 64, z: 4 });
    assert.equal(dist, 5, 'distance (3, 0, 4) should be 5 (3-4-5 right triangle)');
  });

  it('should compute distance when goal has different y coordinate', () => {
    const bot = { entity: { position: { x: 0, y: 0, z: 0 } }, pathfinder: { goto: mock.fn() } };
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    // goal at (0, 4, 3) => sqrt(0 + 16 + 9) = sqrt(25) = 5
    const dist = pq.calculateDistance({ x: 0, y: 4, z: 3 });
    assert.equal(dist, 5, 'distance (0, 4, 3) should be 5');
  });

  it('should use bot.entity.position as the origin', () => {
    const bot = { entity: { position: { x: 10, y: 64, z: 10 } }, pathfinder: { goto: mock.fn() } };
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    // bot at (10, 64, 10), goal at (10, 64, 20) => sqrt(0+0+100) = 10
    const dist = pq.calculateDistance({ x: 10, y: 64, z: 20 });
    assert.equal(dist, 10, 'distance from (10,64,10) to (10,64,20) should be 10');
  });
});

// ── process ───────────────────────────────────────────────────

describe('PathfindingQueue — process', () => {
  it('should return { success: false, attempts: 0, goal: null } when queue is empty', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    const result = await pq.process();
    assert.equal(result.success, false, 'success should be false on empty queue');
    assert.equal(result.attempts, 0, 'attempts should be 0 on empty queue');
    assert.equal(result.goal, null, 'goal should be null on empty queue');
  });

  it('should succeed on first attempt when goto resolves', async () => {
    const bot = makeBot(async () => {});
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0, label: 'target' });

    const result = await pq.process();

    assert.equal(result.success, true, 'success should be true when goto resolves');
    assert.equal(result.attempts, 1, 'attempts should be 1 on first-attempt success');
    assert.equal(result.goal.label, 'target', 'goal should be returned in result');
  });

  it('should remove goal from queue after processing', async () => {
    const bot = makeBot(async () => {});
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });
    pq.enqueue({ x: 20, y: 64, z: 0 });

    await pq.process();

    assert.equal(pq.queue.length, 1, 'queue should have 1 item remaining after processing one');
  });

  it('should dequeue in FIFO order', async () => {
    const processedGoals = [];
    const bot = makeBot(async (goal) => { processedGoals.push(goal.label); });
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });

    pq.enqueue({ x: 10, y: 64, z: 0, label: 'first' });
    pq.enqueue({ x: 20, y: 64, z: 0, label: 'second' });

    await pq.process();

    assert.equal(processedGoals[0], 'first', 'first enqueued goal should be processed first');
  });

  it('should retry up to 3 attempts on failure then give up', async () => {
    const error = new Error('pathfinding failed');
    const bot = makeBot(async () => { throw error; });
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });

    const result = await pq.process();

    assert.equal(result.success, false, 'success should be false after all retries exhausted');
    assert.equal(result.attempts, 3, 'should have attempted exactly 3 times');
    assert.equal(bot.pathfinder.goto.mock.calls.length, 3, 'goto should be called 3 times');
  });

  it('should succeed on retry after initial failure', async () => {
    let callCount = 0;
    const bot = makeBot(async () => {
      callCount++;
      if (callCount < 2) throw new Error('first attempt failed');
    });
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });

    const result = await pq.process();

    assert.equal(result.success, true, 'success should be true after retry succeeds');
    assert.equal(result.attempts, 2, 'attempts should be 2 (fail once, succeed on second)');
  });

  it('should increment successCount in metrics on success', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });
    await pq.process();

    assert.equal(pq.metrics.successCount, 1, 'successCount should be 1 after successful navigation');
  });

  it('should increment failCount in metrics after all retries exhausted', async () => {
    const bot = makeBot(async () => { throw new Error('always fails'); });
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });

    await pq.process();

    assert.equal(pq.metrics.failCount, 1, 'failCount should be 1 after failure');
    assert.equal(pq.metrics.successCount, 0, 'successCount should remain 0 on failure');
  });

  it('should call bot.pathfinder.goto with the goal', async () => {
    const bot = makeBot(async () => {});
    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    const goal = { x: 15, y: 64, z: 25 };
    pq.enqueue(goal);

    await pq.process();

    assert.equal(bot.pathfinder.goto.mock.calls.length, 1, 'goto should be called once');
    const [passedGoal] = bot.pathfinder.goto.mock.calls[0].arguments;
    assert.equal(passedGoal.x, 15, 'goto should receive goal.x');
    assert.equal(passedGoal.z, 25, 'goto should receive goal.z');
  });

  it('should publish metrics after successful process', async () => {
    const board = makeBoard();
    const pq = new PathfindingQueue({ board, bot: makeBot(), agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });

    await pq.process();

    assert.ok(
      board.setConfig.mock.calls.length >= 1,
      'board.setConfig should be called after successful process'
    );
    assert.ok(
      board.publish.mock.calls.length >= 1,
      'board.publish should be called after successful process'
    );
  });
});

// ── processAll ────────────────────────────────────────────────

describe('PathfindingQueue — processAll', () => {
  it('should return an empty array when queue is empty', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    const results = await pq.processAll();
    assert.deepEqual(results, [], 'processAll on empty queue should return []');
  });

  it('should process all queued goals and return an array of results', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });
    pq.enqueue({ x: 20, y: 64, z: 0 });
    pq.enqueue({ x: 30, y: 64, z: 0 });

    const results = await pq.processAll();

    assert.equal(results.length, 3, 'processAll should return 3 results for 3 queued goals');
    assert.equal(pq.queue.length, 0, 'queue should be empty after processAll');
  });

  it('should return results in FIFO order', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0, label: 'A' });
    pq.enqueue({ x: 20, y: 64, z: 0, label: 'B' });

    const results = await pq.processAll();

    assert.equal(results[0].goal.label, 'A', 'first result should be for goal A');
    assert.equal(results[1].goal.label, 'B', 'second result should be for goal B');
  });

  it('should accumulate metrics across all goals in processAll', async () => {
    let callCount = 0;
    const bot = makeBot(async () => {
      callCount++;
      if (callCount === 2) throw new Error('second fails on all attempts');
    });
    // Make all 3 attempts for the second goal fail
    bot.pathfinder.goto = mock.fn(async () => {
      callCount++;
      if (callCount >= 4 && callCount <= 6) throw new Error('second fails');
    });

    const pq = new PathfindingQueue({ board: makeBoard(), bot, agentId: 'bot-01' });
    // Reset and use a predictable failing pattern
    callCount = 0;
    let gotoCall = 0;
    bot.pathfinder.goto = mock.fn(async () => {
      gotoCall++;
      // goal 1: success (calls 1)
      // goal 2: fail all 3 retries (calls 2, 3, 4)
      // goal 3: success (call 5)
      if (gotoCall >= 2 && gotoCall <= 4) throw new Error('fails');
    });

    pq.enqueue({ x: 10, y: 64, z: 0, label: 'pass' });
    pq.enqueue({ x: 20, y: 64, z: 0, label: 'fail' });
    pq.enqueue({ x: 30, y: 64, z: 0, label: 'pass2' });

    const results = await pq.processAll();

    assert.equal(results.length, 3, 'should return result for each goal');
    assert.equal(results[0].success, true, 'first goal should succeed');
    assert.equal(results[1].success, false, 'second goal should fail');
    assert.equal(results[2].success, true, 'third goal should succeed');
    assert.equal(pq.metrics.successCount, 2, 'successCount should be 2');
    assert.equal(pq.metrics.failCount, 1, 'failCount should be 1');
  });
});

// ── publishMetrics ────────────────────────────────────────────

describe('PathfindingQueue — publishMetrics', () => {
  let board, pq;

  beforeEach(() => {
    board = makeBoard();
    pq = new PathfindingQueue({ board, bot: makeBot(), agentId: 'miner-01' });
  });

  it('should call board.setConfig with key pathfinding:metrics:{agentId}', async () => {
    await pq.publishMetrics({ successCount: 5, failCount: 1, totalDistance: 200, totalGoals: 6 });
    assert.equal(board.setConfig.mock.calls.length, 1, 'setConfig should be called once');
    const [key] = board.setConfig.mock.calls[0].arguments;
    assert.equal(key, 'pathfinding:metrics:miner-01', 'setConfig key should be pathfinding:metrics:{agentId}');
  });

  it('should pass metrics object as value to board.setConfig', async () => {
    const metrics = { successCount: 3, failCount: 0, totalDistance: 150, totalGoals: 3 };
    await pq.publishMetrics(metrics);
    const [, value] = board.setConfig.mock.calls[0].arguments;
    assert.equal(value.successCount, 3, 'setConfig value should include successCount');
    assert.equal(value.failCount, 0, 'setConfig value should include failCount');
  });

  it('should call board.publish on channel pathfinding:metrics:updated', async () => {
    await pq.publishMetrics({ successCount: 1, failCount: 0, totalDistance: 50, totalGoals: 1 });
    assert.equal(board.publish.mock.calls.length, 1, 'board.publish should be called once');
    const [channel] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'pathfinding:metrics:updated', 'publish channel should be pathfinding:metrics:updated');
  });

  it('should include agentId in publish payload', async () => {
    await pq.publishMetrics({ successCount: 1, failCount: 0, totalDistance: 50, totalGoals: 1 });
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.agentId, 'miner-01', 'publish data should include agentId');
  });

  it('should include author field set to pathfinding-queue in publish payload', async () => {
    await pq.publishMetrics({ successCount: 0, failCount: 0, totalDistance: 0, totalGoals: 0 });
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.author, 'pathfinding-queue', 'publish data must include author=pathfinding-queue');
  });

  it('should spread metrics fields into publish payload', async () => {
    const metrics = { successCount: 7, failCount: 2, totalDistance: 300, totalGoals: 9 };
    await pq.publishMetrics(metrics);
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.successCount, 7, 'publish data should include successCount from metrics');
    assert.equal(data.failCount, 2, 'publish data should include failCount from metrics');
    assert.equal(data.totalDistance, 300, 'publish data should include totalDistance from metrics');
    assert.equal(data.totalGoals, 9, 'publish data should include totalGoals from metrics');
  });
});

// ── metrics tracking ──────────────────────────────────────────

describe('PathfindingQueue — metrics tracking', () => {
  it('should increment totalGoals on each process() call with a queued item', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    pq.enqueue({ x: 10, y: 64, z: 0 });
    pq.enqueue({ x: 20, y: 64, z: 0 });

    await pq.process();
    assert.equal(pq.metrics.totalGoals, 1, 'totalGoals should be 1 after first process()');

    await pq.process();
    assert.equal(pq.metrics.totalGoals, 2, 'totalGoals should be 2 after second process()');
  });

  it('should not increment totalGoals on empty queue process()', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    await pq.process();
    assert.equal(pq.metrics.totalGoals, 0, 'totalGoals should remain 0 on empty queue process()');
  });

  it('should accumulate totalDistance across successful processes', async () => {
    // bot at (0, 64, 0)
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    // goal 1: (3, 64, 4) => dist = 5
    // goal 2: (0, 64, 12) => dist = 12
    pq.enqueue({ x: 3, y: 64, z: 4 });
    pq.enqueue({ x: 0, y: 64, z: 12 });

    await pq.processAll();

    assert.equal(pq.metrics.totalDistance, 17, 'totalDistance should accumulate: 5 + 12 = 17');
  });

  it('should not change successCount or failCount on empty queue process()', async () => {
    const pq = new PathfindingQueue({ board: makeBoard(), bot: makeBot(), agentId: 'bot-01' });
    await pq.process();
    assert.equal(pq.metrics.successCount, 0, 'successCount should remain 0');
    assert.equal(pq.metrics.failCount, 0, 'failCount should remain 0');
  });
});
