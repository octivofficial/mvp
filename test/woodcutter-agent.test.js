/**
 * WoodcutterAgent Tests — Phase 3.5
 * Usage: node --test --test-force-exit test/woodcutter-agent.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { WoodcutterAgent } = require('../agent/roles/WoodcutterAgent');

// ── Mock Helpers ─────────────────────────────────────────────────────

function createMockBoard() {
  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    setHashField: mock.fn(async () => {}),
    deleteHashField: mock.fn(async () => {}),
  };
}

function createMockBot(findBlockResult = null) {
  return {
    version: '1.21.1',
    findBlock: mock.fn(() => findBlockResult),
  };
}

function createAgent(config = {}) {
  const agent = new WoodcutterAgent({ id: 'woodcutter-01', ...config });
  agent.board = createMockBoard();
  return agent;
}

// ── Constructor ──────────────────────────────────────────────────────

describe('WoodcutterAgent — Constructor', () => {
  it('should have default role, targetCount, and collected values', () => {
    const agent = new WoodcutterAgent({ id: 'woodcutter-01' });
    agent.board = createMockBoard();
    assert.equal(agent.role, 'woodcutter');
    assert.equal(agent.targetCount, 16);
    assert.equal(agent.collected, 0);
  });

  it('should accept custom targetCount from config', () => {
    const agent = new WoodcutterAgent({ id: 'woodcutter-01', targetCount: 32 });
    agent.board = createMockBoard();
    assert.equal(agent.targetCount, 32);
  });
});

// ── execute — log found ──────────────────────────────────────────────

describe('WoodcutterAgent — execute with log found', () => {
  it('should increment collected and publish to board when log is found', async () => {
    const agent = createAgent();
    const block = { name: 'oak_log', position: { x: 10, y: 64, z: 10 } };
    const bot = createMockBot(block);

    const result = await agent.execute(bot);

    assert.equal(result.success, true);
    assert.equal(agent.collected, 1);

    const collectCall = agent.board.publish.mock.calls.find(
      c => c.arguments[0] === 'agent:woodcutter-01:collecting'
    );
    assert.ok(collectCall, 'should publish collecting event');
    assert.equal(collectCall.arguments[1].author, 'woodcutter-01');
    assert.equal(collectCall.arguments[1].block, 'wood');
    assert.equal(collectCall.arguments[1].collected, 1);
  });

  it('should return done=true when collected reaches targetCount', async () => {
    const agent = createAgent({ targetCount: 1 });
    const block = { name: 'oak_log', position: { x: 10, y: 64, z: 10 } };
    const bot = createMockBot(block);

    const result = await agent.execute(bot);

    assert.equal(result.success, true);
    assert.equal(result.done, true);
    assert.equal(result.collected, 1);
  });
});

// ── execute — no logs ────────────────────────────────────────────────

describe('WoodcutterAgent — execute with no logs', () => {
  it('should return success=false with reason no_logs_found when findBlock returns null', async () => {
    const agent = createAgent();
    const bot = createMockBot(null);

    const result = await agent.execute(bot);

    assert.equal(result.success, false);
    assert.equal(result.reason, 'no_logs_found');
  });
});

// ── execute — custom target ──────────────────────────────────────────

describe('WoodcutterAgent — custom targetCount', () => {
  it('should reach done=true after exactly targetCount executions', async () => {
    const agent = createAgent({ targetCount: 2 });
    const block = { name: 'oak_log', position: { x: 10, y: 64, z: 10 } };
    const bot = createMockBot(block);

    const first = await agent.execute(bot);
    assert.equal(first.done, false);
    assert.equal(first.collected, 1);

    const second = await agent.execute(bot);
    assert.equal(second.done, true);
    assert.equal(second.collected, 2);
  });
});

// ── execute — status reporting ───────────────────────────────────────

describe('WoodcutterAgent — status reporting', () => {
  it('should call reportStatus with collecting then chopping when log is found', async () => {
    const agent = createAgent();
    const block = { name: 'oak_log', position: { x: 10, y: 64, z: 10 } };
    const bot = createMockBot(block);

    await agent.execute(bot);

    const statusCalls = agent.board.publish.mock.calls.filter(
      c => c.arguments[0] === 'agent:woodcutter-01:status'
    );

    const statuses = statusCalls.map(c => c.arguments[1].status);
    assert.ok(statuses.includes('collecting'), 'should report collecting status');
    assert.ok(statuses.includes('chopping'), 'should report chopping status');
  });
});
