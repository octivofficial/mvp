/**
 * InventoryTracker Tests — TDD Red-Green-Refactor
 * Requirements (Phase 3, Requirement 4):
 *   - getInventory() aggregates bot.inventory.items() into plain object by name
 *   - trackConsumption(itemName, count) decrements this.state, never below 0
 *   - trackAcquisition(itemName, count) increments this.state, creates key if absent
 *   - publish() calls board.setConfig and board.publish with author field
 *   - hasItem(itemName, count) checks this.state[itemName] >= count
 *
 * Usage: node --test test/inventory-tracker.test.js
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { InventoryTracker } = require('../agent/inventory-tracker');

// ── Mock factories ────────────────────────────────────────────

function createMockBoard() {
  return {
    setConfig: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
  };
}

function createMockBot(items = []) {
  return {
    inventory: {
      items: mock.fn(() => items),
    },
  };
}

// ── constructor ───────────────────────────────────────────────

describe('InventoryTracker — constructor', () => {
  it('should store board, bot, and agentId from options', () => {
    const board = createMockBoard();
    const bot = createMockBot();
    const tracker = new InventoryTracker({ board, bot, agentId: 'builder-01' });
    assert.equal(tracker.agentId, 'builder-01', 'agentId should be stored');
    assert.equal(tracker.board, board, 'board should be stored');
    assert.equal(tracker.bot, bot, 'bot should be stored');
  });

  it('should initialize this.state as an empty object', () => {
    const tracker = new InventoryTracker({
      board: createMockBoard(),
      bot: createMockBot(),
      agentId: 'miner-01',
    });
    assert.deepEqual(tracker.state, {}, 'initial state should be empty object');
  });
});

// ── getInventory ──────────────────────────────────────────────

describe('InventoryTracker — getInventory', () => {
  let board, bot, tracker;

  beforeEach(() => {
    board = createMockBoard();
    bot = createMockBot([
      { name: 'oak_log', count: 5 },
      { name: 'stone', count: 12 },
    ]);
    tracker = new InventoryTracker({ board, bot, agentId: 'builder-01' });
  });

  it('should call bot.inventory.items() and return aggregated object', async () => {
    const inv = await tracker.getInventory();
    assert.equal(bot.inventory.items.mock.calls.length, 1, 'items() should be called once');
    assert.equal(inv.oak_log, 5, 'oak_log count should be 5');
    assert.equal(inv.stone, 12, 'stone count should be 12');
  });

  it('should aggregate duplicate item names by summing counts', async () => {
    bot.inventory.items = mock.fn(() => [
      { name: 'oak_log', count: 3 },
      { name: 'oak_log', count: 7 },
    ]);
    const inv = await tracker.getInventory();
    assert.equal(inv.oak_log, 10, 'duplicate oak_log entries should be summed to 10');
  });

  it('should return empty object when bot has no items', async () => {
    bot.inventory.items = mock.fn(() => []);
    const inv = await tracker.getInventory();
    assert.deepEqual(inv, {}, 'empty inventory should return empty object');
  });

  it('should return {} and not throw when bot.inventory.items() throws', async () => {
    bot.inventory.items = mock.fn(() => {
      throw new Error('bot disconnected');
    });
    const inv = await tracker.getInventory();
    assert.deepEqual(inv, {}, 'should return empty object on error');
  });

  it('should update this.state with the retrieved inventory', async () => {
    await tracker.getInventory();
    assert.equal(tracker.state.oak_log, 5, 'state.oak_log should be updated');
    assert.equal(tracker.state.stone, 12, 'state.stone should be updated');
  });
});

// ── trackConsumption ──────────────────────────────────────────

describe('InventoryTracker — trackConsumption', () => {
  let board, bot, tracker;

  beforeEach(() => {
    board = createMockBoard();
    bot = createMockBot();
    tracker = new InventoryTracker({ board, bot, agentId: 'builder-01' });
    tracker.state = { oak_log: 10, stone: 5 };
  });

  it('should decrement the item count by the given amount', () => {
    tracker.trackConsumption('oak_log', 3);
    assert.equal(tracker.state.oak_log, 7, 'oak_log should be decremented by 3');
  });

  it('should never let count go below 0', () => {
    tracker.trackConsumption('stone', 99);
    assert.equal(tracker.state.stone, 0, 'stone should be clamped to 0, not negative');
  });

  it('should handle decrement to exactly 0 correctly', () => {
    tracker.trackConsumption('stone', 5);
    assert.equal(tracker.state.stone, 0, 'stone should be exactly 0');
  });

  it('should create the key at 0 if item does not exist in state', () => {
    tracker.trackConsumption('coal', 2);
    assert.equal(tracker.state.coal, 0, 'non-existent item should be set to 0 (not negative)');
  });

  it('should not affect other items when decrementing', () => {
    tracker.trackConsumption('oak_log', 4);
    assert.equal(tracker.state.stone, 5, 'stone should remain unchanged');
  });
});

// ── trackAcquisition ─────────────────────────────────────────

describe('InventoryTracker — trackAcquisition', () => {
  let board, bot, tracker;

  beforeEach(() => {
    board = createMockBoard();
    bot = createMockBot();
    tracker = new InventoryTracker({ board, bot, agentId: 'builder-01' });
    tracker.state = { oak_log: 5 };
  });

  it('should increment the item count by the given amount', () => {
    tracker.trackAcquisition('oak_log', 3);
    assert.equal(tracker.state.oak_log, 8, 'oak_log should be incremented by 3');
  });

  it('should create the key when the item does not exist in state', () => {
    tracker.trackAcquisition('iron_ore', 4);
    assert.equal(tracker.state.iron_ore, 4, 'new item iron_ore should be set to 4');
  });

  it('should handle acquiring 0 items (no-op)', () => {
    tracker.trackAcquisition('oak_log', 0);
    assert.equal(tracker.state.oak_log, 5, 'oak_log should remain 5 when acquiring 0');
  });

  it('should not affect other items when acquiring', () => {
    tracker.trackAcquisition('stone', 10);
    assert.equal(tracker.state.oak_log, 5, 'oak_log should remain unchanged');
  });

  it('should accumulate multiple acquisitions of the same item', () => {
    tracker.trackAcquisition('oak_log', 2);
    tracker.trackAcquisition('oak_log', 3);
    assert.equal(tracker.state.oak_log, 10, 'successive acquisitions should accumulate: 5+2+3=10');
  });
});

// ── publish ───────────────────────────────────────────────────

describe('InventoryTracker — publish', () => {
  let board, bot, tracker;

  beforeEach(() => {
    board = createMockBoard();
    bot = createMockBot();
    tracker = new InventoryTracker({ board, bot, agentId: 'miner-01' });
    tracker.state = { iron_ore: 8, coal: 3 };
  });

  it('should call board.setConfig with the correct key', async () => {
    await tracker.publish();
    assert.equal(board.setConfig.mock.calls.length, 1, 'setConfig should be called once');
    const [key] = board.setConfig.mock.calls[0].arguments;
    assert.equal(key, 'agent:miner-01:inventory', 'setConfig key should match agent:agentId:inventory');
  });

  it('should call board.setConfig with current state as value', async () => {
    await tracker.publish();
    const [, value] = board.setConfig.mock.calls[0].arguments;
    assert.deepEqual(value, { iron_ore: 8, coal: 3 }, 'setConfig value should be current state');
  });

  it('should call board.publish with the correct channel', async () => {
    await tracker.publish();
    assert.equal(board.publish.mock.calls.length, 1, 'board.publish should be called once');
    const [channel] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'agent:miner-01:inventory:updated', 'channel should match agent:agentId:inventory:updated');
  });

  it('should include agentId in the publish data', async () => {
    await tracker.publish();
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.agentId, 'miner-01', 'publish data should include agentId');
  });

  it('should include current inventory state in the publish data', async () => {
    await tracker.publish();
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.deepEqual(data.inventory, { iron_ore: 8, coal: 3 }, 'publish data should include inventory state');
  });

  it('should include author field in publish data (Blackboard validation requirement)', async () => {
    await tracker.publish();
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.ok(
      typeof data.author === 'string' && data.author.length > 0,
      'publish data must include non-empty author field for Blackboard validation'
    );
  });

  it('should call setConfig before publish (correct ordering)', async () => {
    const callOrder = [];
    board.setConfig = mock.fn(async () => { callOrder.push('setConfig'); });
    board.publish = mock.fn(async () => { callOrder.push('publish'); });
    await tracker.publish();
    assert.deepEqual(callOrder, ['setConfig', 'publish'], 'setConfig must be called before publish');
  });
});

// ── hasItem ───────────────────────────────────────────────────

describe('InventoryTracker — hasItem', () => {
  let board, bot, tracker;

  beforeEach(() => {
    board = createMockBoard();
    bot = createMockBot();
    tracker = new InventoryTracker({ board, bot, agentId: 'builder-01' });
    tracker.state = { oak_log: 16, stone: 0 };
  });

  it('should return true when item count meets the required amount', () => {
    assert.equal(tracker.hasItem('oak_log', 16), true, 'should return true for exact count match');
  });

  it('should return true when item count exceeds the required amount', () => {
    assert.equal(tracker.hasItem('oak_log', 10), true, 'should return true when count exceeds requirement');
  });

  it('should return false when item count is below the required amount', () => {
    assert.equal(tracker.hasItem('oak_log', 20), false, 'should return false when count is insufficient');
  });

  it('should return false when item count is 0', () => {
    assert.equal(tracker.hasItem('stone', 1), false, 'stone count=0 should not satisfy count=1');
  });

  it('should return false when item does not exist in state', () => {
    assert.equal(tracker.hasItem('diamond', 1), false, 'missing item should return false');
  });

  it('should use default count=1 when no count argument is provided', () => {
    assert.equal(tracker.hasItem('oak_log'), true, 'should default count to 1');
    assert.equal(tracker.hasItem('stone'), false, 'stone=0 should fail default count=1');
  });
});

// ── integration ───────────────────────────────────────────────

describe('InventoryTracker — integration', () => {
  it('should reflect acquire → publish cycle correctly in board.setConfig', async () => {
    const board = createMockBoard();
    const bot = createMockBot();
    const tracker = new InventoryTracker({ board, bot, agentId: 'farmer-01' });

    tracker.trackAcquisition('wheat', 5);
    tracker.trackAcquisition('carrot', 3);
    tracker.trackConsumption('wheat', 2);

    await tracker.publish();

    const [key, value] = board.setConfig.mock.calls[0].arguments;
    assert.equal(key, 'agent:farmer-01:inventory');
    assert.equal(value.wheat, 3, 'wheat should be 5-2=3');
    assert.equal(value.carrot, 3, 'carrot should remain 3');
  });

  it('should reflect bot inventory via getInventory and then publish that state', async () => {
    const board = createMockBoard();
    const bot = createMockBot([
      { name: 'oak_log', count: 16 },
      { name: 'planks', count: 4 },
    ]);
    const tracker = new InventoryTracker({ board, bot, agentId: 'builder-02' });

    await tracker.getInventory();
    await tracker.publish();

    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.inventory.oak_log, 16, 'published inventory should include oak_log=16');
    assert.equal(data.inventory.planks, 4, 'published inventory should include planks=4');
    assert.equal(data.agentId, 'builder-02', 'agentId should match');
  });

  it('should correctly report hasItem after getInventory populates state', async () => {
    const board = createMockBoard();
    const bot = createMockBot([{ name: 'oak_log', count: 16 }]);
    const tracker = new InventoryTracker({ board, bot, agentId: 'builder-03' });

    await tracker.getInventory();

    assert.equal(tracker.hasItem('oak_log', 16), true, 'should have 16 oak_log after getInventory');
    assert.equal(tracker.hasItem('oak_log', 17), false, 'should not have 17 oak_log');
    assert.equal(tracker.hasItem('iron_ore', 1), false, 'iron_ore not in state, should return false');
  });
});
