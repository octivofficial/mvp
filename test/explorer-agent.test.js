/**
 * ExplorerAgent Tests — Phase 3.5 + 6.4
 * Spiral scout agent: danger detection, resource discovery, world map building.
 * Usage: node --test --test-force-exit test/explorer-agent.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { ExplorerAgent, DANGER_BLOCKS, SPIRAL_STEP } = require('../agent/roles/ExplorerAgent');

// ── Mock Helpers ────────────────────────────────────────────────────

function createMockBoard() {
  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    setHashField: mock.fn(async () => {}),
    deleteHashField: mock.fn(async () => {}),
  };
}

function createMockBot(blockAtFn = () => null) {
  return {
    entity: { position: { x: 100, y: 64, z: 100 } },
    blockAt: blockAtFn,
  };
}

// Helper: create agent with mock board and chat injected
function createAgent(overrides = {}) {
  const board = createMockBoard();
  const agent = new ExplorerAgent({ id: 'explorer-01', ...overrides });
  agent.board = board;
  agent.chat = { chat: mock.fn(async () => {}), confess: mock.fn(async () => {}) };
  return { agent, board };
}

// ── Constructor ──────────────────────────────────────────────────────

describe('ExplorerAgent — Constructor', () => {
  it('should have default values: role=explorer, maxRadius=200, empty worldMap/dangerZones', () => {
    const { agent } = createAgent();
    assert.equal(agent.role, 'explorer');
    assert.equal(agent.maxRadius, 200);
    assert.deepEqual(agent.worldMap, {});
    assert.deepEqual(agent.dangerZones, []);
  });

  it('should accept custom id and maxRadius from config', () => {
    const { agent } = createAgent({ id: 'scout-99', maxRadius: 500 });
    assert.equal(agent.id, 'scout-99');
    assert.equal(agent.maxRadius, 500);
  });

  it('should have spiralIndex starting at 0', () => {
    const { agent } = createAgent();
    assert.equal(agent.spiralIndex, 0);
  });
});

// ── _nextSpiralPoint ─────────────────────────────────────────────────

describe('ExplorerAgent — _nextSpiralPoint', () => {
  it('first call increments spiralIndex to 1 and returns a center-offset point', () => {
    const { agent } = createAgent();
    const center = { x: 0, y: 64, z: 0 };
    const point = agent._nextSpiralPoint(center);

    assert.equal(agent.spiralIndex, 1);
    assert.equal(typeof point.x, 'number');
    assert.equal(typeof point.z, 'number');
    assert.equal(point.y, center.y);
  });

  it('multiple calls produce different waypoints', () => {
    const { agent } = createAgent();
    const center = { x: 50, y: 64, z: 50 };

    const points = [];
    for (let i = 0; i < 5; i++) {
      points.push(agent._nextSpiralPoint(center));
    }

    // Verify at least two distinct points exist among the five
    const unique = new Set(points.map(p => `${p.x},${p.z}`));
    assert.ok(unique.size >= 2, 'spiral should produce distinct points');
  });

  it('respects SPIRAL_STEP spacing — offsets are multiples of SPIRAL_STEP', () => {
    const { agent } = createAgent();
    const center = { x: 0, y: 64, z: 0 };

    // Generate many points and verify x/z offsets from center are multiples of SPIRAL_STEP
    // Use Math.abs to handle -0 === 0 equivalence in JS modulo
    for (let i = 0; i < 10; i++) {
      const p = agent._nextSpiralPoint(center);
      const dx = p.x - center.x;
      const dz = p.z - center.z;
      assert.equal(Math.abs(dx % SPIRAL_STEP), 0, `dx=${dx} should be a multiple of SPIRAL_STEP=${SPIRAL_STEP}`);
      assert.equal(Math.abs(dz % SPIRAL_STEP), 0, `dz=${dz} should be a multiple of SPIRAL_STEP=${SPIRAL_STEP}`);
    }
  });
});

// ── _scanArea ────────────────────────────────────────────────────────

describe('ExplorerAgent — _scanArea', () => {
  it('returns empty dangers and resources when bot has no blockAt', () => {
    const { agent } = createAgent();
    const botWithoutBlockAt = { entity: { position: { x: 0, y: 64, z: 0 } } };
    const result = agent._scanArea(botWithoutBlockAt, { x: 0, y: 64, z: 0 });
    assert.deepEqual(result, { dangers: [], resources: [] });
  });

  it('finds danger blocks (lava, fire) when blockAt returns them', () => {
    const { agent } = createAgent();
    // Return lava at a specific position, null elsewhere
    const bot = createMockBot((pos) => {
      if (pos.x === 5 && pos.y === 64 && pos.z === 5) return { name: 'lava' };
      if (pos.x === 3 && pos.y === 64 && pos.z === 3) return { name: 'fire' };
      return null;
    });
    const center = { x: 0, y: 64, z: 0 };
    const result = agent._scanArea(bot, center);

    const dangerTypes = result.dangers.map(d => d.type);
    assert.ok(dangerTypes.includes('lava'), 'should detect lava');
    assert.ok(dangerTypes.includes('fire'), 'should detect fire');
    assert.ok(result.dangers.length >= 2, 'should find at least 2 danger blocks');
  });

  it('finds resource blocks (iron_ore, chest) when blockAt returns them', () => {
    const { agent } = createAgent();
    const bot = createMockBot((pos) => {
      if (pos.x === 2 && pos.y === 64 && pos.z === 2) return { name: 'iron_ore' };
      if (pos.x === -2 && pos.y === 64 && pos.z === -2) return { name: 'chest' };
      return null;
    });
    const center = { x: 0, y: 64, z: 0 };
    const result = agent._scanArea(bot, center);

    const resourceTypes = result.resources.map(r => r.type);
    assert.ok(resourceTypes.includes('iron_ore'), 'should detect iron_ore');
    assert.ok(resourceTypes.includes('chest'), 'should detect chest');
  });

  it('handles null block returns from blockAt without throwing', () => {
    const { agent } = createAgent();
    const bot = createMockBot(() => null);
    const center = { x: 0, y: 64, z: 0 };

    assert.doesNotThrow(() => agent._scanArea(bot, center));
    const result = agent._scanArea(bot, center);
    assert.deepEqual(result, { dangers: [], resources: [] });
  });
});

// ── execute() ────────────────────────────────────────────────────────

describe('ExplorerAgent — execute()', () => {
  it('successful execution returns {success:true, radius, totalDiscoveries}', async () => {
    const { agent } = createAgent();
    const bot = createMockBot(() => null);

    const result = await agent.execute(bot);

    assert.equal(result.success, true);
    assert.equal(typeof result.radius, 'number');
    assert.ok(result.radius > 0, 'radius should increase after execution');
    assert.equal(result.totalDiscoveries, 1);
  });

  it('updates worldMap with scan result after execution', async () => {
    const { agent } = createAgent();
    const bot = createMockBot(() => null);

    await agent.execute(bot);

    const keys = Object.keys(agent.worldMap);
    assert.equal(keys.length, 1, 'worldMap should have one entry');
    const entry = agent.worldMap[keys[0]];
    assert.ok(Array.isArray(entry.dangers), 'worldMap entry should have dangers array');
    assert.ok(Array.isArray(entry.resources), 'worldMap entry should have resources array');
    assert.ok(typeof entry.scannedAt === 'number', 'worldMap entry should have scannedAt timestamp');
  });

  it('publishes explored event to board after execution', async () => {
    const { agent, board } = createAgent();
    const bot = createMockBot(() => null);

    await agent.execute(bot);

    const exploredCall = board.publish.mock.calls.find(
      c => c.arguments[0] === `agent:explorer-01:explored`
    );
    assert.ok(exploredCall, 'should publish explored event');
    assert.equal(exploredCall.arguments[1].author, 'explorer-01');
  });
});

// ── isPositionSafe ────────────────────────────────────────────────────

describe('ExplorerAgent — isPositionSafe', () => {
  it('returns true when no danger zones are registered', () => {
    const { agent } = createAgent();
    const pos = { x: 100, y: 64, z: 100 };
    assert.equal(agent.isPositionSafe(pos), true);
  });

  it('returns false when position is within minDistance of a danger zone', () => {
    const { agent } = createAgent();
    // Manually inject a danger zone close to test position
    agent.dangerZones.push({ x: 100, y: 64, z: 100, type: 'lava' });

    const nearPos = { x: 101, y: 64, z: 100 }; // distance = 1, < default 5
    assert.equal(agent.isPositionSafe(nearPos), false);
  });
});

// ── getWorldMap / getDangerZones ─────────────────────────────────────

describe('ExplorerAgent — getWorldMap / getDangerZones', () => {
  it('returns copies (not references) of internal state', async () => {
    const { agent } = createAgent();
    const bot = createMockBot((pos) => {
      if (pos.x === 1 && pos.y === 64 && pos.z === 1) return { name: 'lava' };
      return null;
    });

    await agent.execute(bot);

    // Mutate the returned copies
    const worldMapCopy = agent.getWorldMap();
    worldMapCopy['fake_key'] = { injected: true };

    const dangerZonesCopy = agent.getDangerZones();
    dangerZonesCopy.push({ x: 999, y: 999, z: 999, type: 'fake' });

    // Internal state should remain unchanged
    assert.equal(agent.worldMap['fake_key'], undefined, 'worldMap should not be mutated externally');
    const internalDangers = agent.dangerZones.filter(d => d.type === 'fake');
    assert.equal(internalDangers.length, 0, 'dangerZones should not be mutated externally');
  });
});

// ── DANGER_BLOCKS / SPIRAL_STEP exports ─────────────────────────────

describe('ExplorerAgent — Exported Constants', () => {
  it('DANGER_BLOCKS should be a non-empty array including lava and fire', () => {
    assert.ok(Array.isArray(DANGER_BLOCKS));
    assert.ok(DANGER_BLOCKS.length > 0);
    assert.ok(DANGER_BLOCKS.includes('lava'));
    assert.ok(DANGER_BLOCKS.includes('fire'));
  });

  it('SPIRAL_STEP should be a positive number', () => {
    assert.equal(typeof SPIRAL_STEP, 'number');
    assert.ok(SPIRAL_STEP > 0);
  });
});

// ── confess triggers ─────────────────────────────────────────────────

describe('ExplorerAgent — danger_spotted chat (lines 66-70)', () => {
  it('should call chat with danger_spotted when execute finds danger blocks', async () => {
    const { agent } = createAgent();
    const chatArgs = [];
    agent.chat = {
      chat: mock.fn(async (...args) => { chatArgs.push(args); }),
      confess: mock.fn(async () => {}),
    };

    // blockAt always returns lava so all 847 scan positions are dangers
    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => ({ name: 'lava' }),
    };

    await agent.execute(mockBot);

    const dangerSpotted = chatArgs.filter(a => a[0] === 'danger_spotted');
    assert.ok(dangerSpotted.length >= 1, 'should call chat with danger_spotted at least once');
    assert.equal(dangerSpotted[0][0], 'danger_spotted');
    assert.ok(dangerSpotted[0][1].type, 'danger_spotted payload should have type');
  });

  it('should report each danger type only once per execute call (dedup)', async () => {
    const { agent } = createAgent();
    const chatArgs = [];
    agent.chat = {
      chat: mock.fn(async (...args) => { chatArgs.push(args); }),
      confess: mock.fn(async () => {}),
    };

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => ({ name: 'fire' }),
    };

    await agent.execute(mockBot);

    const fireSpotted = chatArgs.filter(a => a[0] === 'danger_spotted' && a[1].type === 'fire');
    assert.equal(fireSpotted.length, 1, 'should only report fire once despite many fire blocks');
  });
});

describe('ExplorerAgent — danger_zone confess (lines 73-75)', () => {
  it('should call confess with danger_zone when dangerZones.length is a multiple of 5', async () => {
    const { agent } = createAgent();
    const confessArgs = [];
    agent.chat = {
      chat: mock.fn(async () => {}),
      confess: mock.fn(async (...args) => { confessArgs.push(args); }),
    };

    // Pre-fill 3 dangers so that 3 + 847 (full lava scan) = 850, which is divisible by 5
    for (let i = 0; i < 3; i++) {
      agent.dangerZones.push({ type: 'lava', x: i, y: 64, z: i });
    }

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => ({ name: 'lava' }),
    };

    await agent.execute(mockBot);

    assert.equal(agent.dangerZones.length % 5, 0, 'dangerZones.length should be a multiple of 5');
    const dangerZoneConfess = confessArgs.find(a => a[0] === 'danger_zone');
    assert.ok(dangerZoneConfess, 'should confess danger_zone when length is multiple of 5');
    assert.equal(dangerZoneConfess[1].dangerCount, agent.dangerZones.length);
  });
});

describe('ExplorerAgent — milestone confess (lines 78-80)', () => {
  it('should call confess with milestone after every 10th discovery', async () => {
    const { agent } = createAgent();
    const confessArgs = [];
    agent.chat = {
      chat: mock.fn(async () => {}),
      confess: mock.fn(async (...args) => { confessArgs.push(args); }),
    };

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => null,
    };

    // Execute 10 times to hit discovered.length === 10
    for (let i = 0; i < 10; i++) {
      await agent.execute(mockBot);
    }

    assert.equal(agent.discovered.length, 10);
    const milestone = confessArgs.find(a => a[0] === 'milestone');
    assert.ok(milestone, 'should confess milestone after 10 discoveries');
    assert.equal(milestone[1].discoveries, 10);
  });
});

// ── .catch(() => {}) callbacks — rejection paths ─────────────────────
// V8 tracks each anonymous arrow function in .catch() as a separate function.
// These tests make chat/confess reject to trigger those callbacks and
// improve function coverage from 63.64% toward 100%.

describe('ExplorerAgent — chat/confess rejection catch callbacks', () => {
  it('should silently swallow rejected chat.chat promise (discovery chat)', async () => {
    const { agent } = createAgent();
    agent.chat = {
      chat: mock.fn(() => Promise.reject(new Error('chat rejection'))),
      confess: mock.fn(() => Promise.reject(new Error('confess rejection'))),
    };

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => null,
    };

    // Should not throw even when chat rejects
    await assert.doesNotReject(() => agent.execute(mockBot));
  });

  it('should silently swallow rejected chat.chat promise (danger_spotted)', async () => {
    const { agent } = createAgent();
    agent.chat = {
      chat: mock.fn(() => Promise.reject(new Error('danger chat rejection'))),
      confess: mock.fn(async () => {}),
    };

    // blockAt returns lava to trigger danger_spotted chat calls
    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => ({ name: 'lava' }),
    };

    await assert.doesNotReject(() => agent.execute(mockBot));
  });

  it('should silently swallow rejected chat.confess promise (danger_zone)', async () => {
    const { agent } = createAgent();
    agent.chat = {
      chat: mock.fn(async () => {}),
      confess: mock.fn(() => Promise.reject(new Error('confess rejection'))),
    };

    // Pre-fill 3 + all-lava = 850 (divisible by 5) to trigger danger_zone confess
    for (let i = 0; i < 3; i++) {
      agent.dangerZones.push({ type: 'lava', x: i, y: 64, z: i });
    }

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => ({ name: 'lava' }),
    };

    await assert.doesNotReject(() => agent.execute(mockBot));
  });

  it('should silently swallow rejected chat.confess promise (milestone)', async () => {
    const { agent } = createAgent();
    agent.chat = {
      chat: mock.fn(async () => {}),
      confess: mock.fn(() => Promise.reject(new Error('milestone rejection'))),
    };

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      blockAt: () => null,
    };

    // Execute 10 times to trigger milestone confess rejection
    for (let i = 0; i < 10; i++) {
      await agent.execute(mockBot);
    }

    assert.equal(agent.discovered.length, 10);
  });
});
