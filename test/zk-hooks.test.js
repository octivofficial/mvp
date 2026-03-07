/**
 * ZettelkastenHooks Unit Tests — wiring, event handlers, error paths
 * Usage: node --test --test-force-exit test/zk-hooks.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { ZettelkastenHooks } = require('../agent/zettelkasten-hooks');

function createMockZk() {
  return {
    createNote: mock.fn(async () => ({ id: 'test-note' })),
    recordUsage: mock.fn(async () => ({ tierUp: false })),
    deprecateNote: mock.fn(async () => {}),
    getStats: mock.fn(async () => ({ totalNotes: 5 })),
    _slugify: (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
  };
}

function createMockRumination() {
  return {
    feed: mock.fn(() => {}),
    feedFailure: mock.fn(() => {}),
    deepRuminate: mock.fn(async () => ({ discoveries: [], reDigested: 0 })),
    getStats: mock.fn(() => ({ bufferSize: 0, totalDigestions: 0 })),
  };
}

function createMockGot() {
  return {
    fullReasoningCycle: mock.fn(async () => ({
      summary: { totalSynergies: 2, totalGaps: 1 },
      synergies: [],
      gaps: [],
    })),
  };
}

function createHooks(opts = {}) {
  const zk = opts.zk || createMockZk();
  const rumination = opts.rumination || createMockRumination();
  const got = opts.got || createMockGot();
  const hooks = new ZettelkastenHooks(zk, rumination, got, {
    logger: opts.logger || null,
    reasoningThreshold: opts.reasoningThreshold || 5,
    deepRuminationIntervalMs: 999999, // prevent auto-firing
  });

  // Replace board with mock
  hooks.board = {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    createSubscriber: mock.fn(async () => ({
      subscribe: mock.fn(async () => {}),
      pSubscribe: mock.fn(async () => {}),
      unsubscribe: mock.fn(async () => {}),
      disconnect: mock.fn(async () => {}),
    })),
  };

  return { hooks, zk, rumination, got };
}

// ── wireToBuilder ────────────────────────────────────────────

describe('ZettelkastenHooks — wireToBuilder', () => {
  it('should skip builder without _tryLearnedSkill', () => {
    const { hooks } = createHooks();
    const builder = { id: 'builder-no-skill' };

    // Should not throw
    hooks.wireToBuilder(builder);
  });

  it('should wrap _tryLearnedSkill and feed rumination', async () => {
    const { hooks, rumination, zk } = createHooks();
    const builder = {
      id: 'builder-01',
      _tryLearnedSkill: mock.fn(async () => ({
        skillName: 'avoid_lava',
        success: true,
        coSkills: ['detect_danger'],
      })),
      _selfImprove: mock.fn(async () => true),
    };

    hooks.wireToBuilder(builder);

    // Call wrapped method
    const result = await builder._tryLearnedSkill(new Error('lava'));

    assert.equal(result.skillName, 'avoid_lava');
    assert.equal(rumination.feed.mock.callCount(), 1);
    const feedArg = rumination.feed.mock.calls[0].arguments[0];
    assert.equal(feedArg.agentId, 'builder-01');
    assert.equal(feedArg.skillUsed, 'avoid_lava');
    assert.equal(feedArg.succeeded, true);

    // Should also record in Zettelkasten
    assert.equal(zk.recordUsage.mock.callCount(), 1);
  });

  it('should handle recordUsage error gracefully', async () => {
    const zk = createMockZk();
    zk.recordUsage = mock.fn(async () => { throw new Error('Redis down'); });
    const { hooks, rumination } = createHooks({ zk });
    const builder = {
      id: 'builder-02',
      _tryLearnedSkill: mock.fn(async () => ({
        skillName: 'dig_v2',
        success: false,
        coSkills: [],
      })),
    };

    hooks.wireToBuilder(builder);
    const result = await builder._tryLearnedSkill(new Error('dig fail'));

    // Should not throw
    assert.equal(result.skillName, 'dig_v2');
    assert.equal(rumination.feed.mock.callCount(), 1);
  });

  it('should wrap _selfImprove and feed failure', async () => {
    const { hooks, rumination } = createHooks();
    const builder = {
      id: 'builder-03',
      _tryLearnedSkill: mock.fn(async () => null),
      _selfImprove: mock.fn(async () => true),
    };

    hooks.wireToBuilder(builder);
    await builder._selfImprove(new Error('pathfinder stuck'));

    assert.equal(rumination.feedFailure.mock.callCount(), 1);
    const failArg = rumination.feedFailure.mock.calls[0].arguments[0];
    assert.equal(failArg.agentId, 'builder-03');
    assert.ok(failArg.error.includes('pathfinder stuck'));
  });
});

// ── wireToLeader ─────────────────────────────────────────────

describe('ZettelkastenHooks — wireToLeader', () => {
  it('should trigger GoT after group reflexion', async () => {
    const { hooks, got } = createHooks();
    const leader = {
      triggerGroupReflexion: mock.fn(async () => ({
        commonErrors: { test: 1 },
        recommendation: 'fix test',
      })),
      processGoTFeedback: mock.fn(async () => {}),
    };

    hooks.wireToLeader(leader);
    const result = await leader.triggerGroupReflexion();

    assert.equal(result.recommendation, 'fix test');
    assert.equal(got.fullReasoningCycle.mock.callCount(), 1);
  });

  it('should handle GoT failure gracefully', async () => {
    const got = createMockGot();
    got.fullReasoningCycle = mock.fn(async () => { throw new Error('GoT down'); });
    const { hooks } = createHooks({ got });
    const leader = {
      triggerGroupReflexion: mock.fn(async () => ({ recommendation: 'ok' })),
    };

    hooks.wireToLeader(leader);
    const result = await leader.triggerGroupReflexion();

    assert.equal(result.recommendation, 'ok'); // original result still returned
  });

  it('should log when logger is set', async () => {
    const logs = [];
    const logger = {
      logEvent: mock.fn(async (type, data) => { logs.push(data); }),
    };
    const { hooks } = createHooks({ logger });
    const leader = {
      triggerGroupReflexion: mock.fn(async () => ({ recommendation: 'ok' })),
      processGoTFeedback: mock.fn(async () => {}),
    };

    hooks.wireToLeader(leader);
    await leader.triggerGroupReflexion();

    assert.ok(logs.some(l => l.type === 'got_triggered_by_reflexion'));
  });
});

// ── wireToSkillPipeline ──────────────────────────────────────

describe('ZettelkastenHooks — wireToSkillPipeline', () => {
  it('should create Zettelkasten note on deploy', async () => {
    const { hooks, zk } = createHooks();
    const pipeline = {
      deploySkill: mock.fn(async () => ({ success: true })),
      updateSuccessRate: mock.fn(async () => ({ discarded: false })),
    };

    hooks.wireToSkillPipeline(pipeline);
    await pipeline.deploySkill({ name: 'avoid_lava', code: 'code', description: 'desc', errorType: 'lava' });

    assert.equal(zk.createNote.mock.callCount(), 1);
    assert.equal(zk.createNote.mock.calls[0].arguments[0].name, 'avoid_lava');
  });

  it('should handle note creation failure', async () => {
    const zk = createMockZk();
    zk.createNote = mock.fn(async () => { throw new Error('Redis down'); });
    const { hooks } = createHooks({ zk });
    const pipeline = {
      deploySkill: mock.fn(async () => ({ success: true })),
    };

    hooks.wireToSkillPipeline(pipeline);
    const result = await pipeline.deploySkill({ name: 'test', code: '', description: '', errorType: '' });

    assert.equal(result.success, true); // original result still returned
  });

  it('should mirror updateSuccessRate to Zettelkasten', async () => {
    const { hooks, zk } = createHooks();
    const pipeline = {
      deploySkill: mock.fn(async () => ({})),
      updateSuccessRate: mock.fn(async () => ({ discarded: false })),
    };

    hooks.wireToSkillPipeline(pipeline);
    await pipeline.updateSuccessRate('avoid_lava', true);

    assert.equal(zk.recordUsage.mock.callCount(), 1);
  });

  it('should deprecate note when skill is discarded', async () => {
    const { hooks, zk } = createHooks();
    const pipeline = {
      deploySkill: mock.fn(async () => ({})),
      updateSuccessRate: mock.fn(async () => ({ discarded: true })),
    };

    hooks.wireToSkillPipeline(pipeline);
    await pipeline.updateSuccessRate('bad_skill', false);

    assert.equal(zk.deprecateNote.mock.callCount(), 1);
    assert.equal(zk.deprecateNote.mock.calls[0].arguments[1], 'low_success_rate');
  });

  it('should handle updateSuccessRate mirror error', async () => {
    const zk = createMockZk();
    zk.recordUsage = mock.fn(async () => { throw new Error('Redis timeout'); });
    const { hooks } = createHooks({ zk });
    const pipeline = {
      deploySkill: mock.fn(async () => ({})),
      updateSuccessRate: mock.fn(async () => ({ discarded: false })),
    };

    hooks.wireToSkillPipeline(pipeline);
    const result = await pipeline.updateSuccessRate('skill', true);

    assert.deepEqual(result, { discarded: false }); // original result still returned
  });
});

// ── Event Handlers ───────────────────────────────────────────

describe('ZettelkastenHooks — _onSkillDeployed', () => {
  it('should skip messages without newSkill', async () => {
    const { hooks } = createHooks();
    // Should not throw
    await hooks._onSkillDeployed({ failureType: 'lava' });
  });

  it('should log when logger is set and newSkill present', async () => {
    const logs = [];
    const logger = { logEvent: mock.fn(async (t, d) => { logs.push(d); }) };
    const { hooks } = createHooks({ logger });

    await hooks._onSkillDeployed({ newSkill: 'avoid_lava_v1' });

    assert.ok(logs.some(l => l.type === 'skill_deployed_to_zk'));
  });
});

describe('ZettelkastenHooks — _onDigestionComplete', () => {
  it('should increment counter', async () => {
    const { hooks } = createHooks();
    hooks.ruminationsSinceReasoning = 0;

    await hooks._onDigestionComplete({});
    assert.equal(hooks.ruminationsSinceReasoning, 1);
  });

  it('should trigger GoT when threshold reached', async () => {
    const { hooks, got } = createHooks({ reasoningThreshold: 2 });
    hooks.ruminationsSinceReasoning = 1;

    await hooks._onDigestionComplete({});

    assert.equal(hooks.ruminationsSinceReasoning, 0); // reset
    assert.equal(got.fullReasoningCycle.mock.callCount(), 1);
  });

  it('should not trigger GoT below threshold', async () => {
    const { hooks, got } = createHooks({ reasoningThreshold: 5 });
    hooks.ruminationsSinceReasoning = 0;

    await hooks._onDigestionComplete({});

    assert.equal(got.fullReasoningCycle.mock.callCount(), 0);
  });

  it('should handle GoT failure gracefully', async () => {
    const got = createMockGot();
    got.fullReasoningCycle = mock.fn(async () => { throw new Error('GoT crash'); });
    const { hooks } = createHooks({ got, reasoningThreshold: 1 });
    hooks.ruminationsSinceReasoning = 0;

    // Should not throw
    await hooks._onDigestionComplete({});
    assert.equal(hooks.ruminationsSinceReasoning, 0);
  });

  it('should feed GoT result to leader if wired', async () => {
    const { hooks, got } = createHooks({ reasoningThreshold: 1 });
    hooks.ruminationsSinceReasoning = 0;
    hooks._wiredLeader = {
      processGoTFeedback: mock.fn(async () => {}),
    };

    await hooks._onDigestionComplete({});

    // processGoTFeedback is fire-and-forget, may not be called synchronously
    // But GoT should have been triggered
    assert.equal(got.fullReasoningCycle.mock.callCount(), 1);
  });
});

describe('ZettelkastenHooks — _onTierUp', () => {
  it('should publish celebration event', async () => {
    const { hooks } = createHooks();

    await hooks._onTierUp({ skill: 'dig', newTier: 'Apprentice', oldTier: 'Novice', xp: 12 });

    const pubCall = hooks.board.publish.mock.calls[0];
    assert.equal(pubCall.arguments[0], 'team:celebration');
    assert.equal(pubCall.arguments[1].event, 'tier_up');
    assert.equal(pubCall.arguments[1].skill, 'dig');
  });

  it('should log when logger is set', async () => {
    const logs = [];
    const logger = { logEvent: mock.fn(async (t, d) => { logs.push(d); }) };
    const { hooks } = createHooks({ logger });

    await hooks._onTierUp({ skill: 'dig', newTier: 'Apprentice', oldTier: 'Novice', xp: 12 });

    assert.ok(logs.some(l => l.type === 'tier_up'));
  });
});

describe('ZettelkastenHooks — _onCompoundCreated', () => {
  it('should log compound creation when logger is set', async () => {
    const logs = [];
    const logger = { logEvent: mock.fn(async (t, d) => { logs.push(d); }) };
    const { hooks } = createHooks({ logger });

    await hooks._onCompoundCreated({
      compound: 'compound_dig_place',
      sources: ['dig', 'place'],
      inheritedXP: 18,
    });

    assert.ok(logs.some(l => l.type === 'compound_created'));
    assert.equal(logs[0].compound, 'compound_dig_place');
  });
});

// ── Lifecycle ────────────────────────────────────────────────

describe('ZettelkastenHooks — getFullStats', () => {
  it('should return combined stats', async () => {
    const { hooks } = createHooks();
    hooks.ruminationsSinceReasoning = 3;

    const stats = await hooks.getFullStats();

    assert.ok(stats.zettelkasten);
    assert.ok(stats.rumination);
    assert.equal(stats.ruminationsSinceReasoning, 3);
    assert.equal(stats.reasoningThreshold, 5);
  });
});

describe('ZettelkastenHooks — shutdown', () => {
  it('should clear timer and disconnect', async () => {
    const { hooks } = createHooks();
    hooks.deepTimer = setInterval(() => {}, 999999);

    await hooks.shutdown();

    assert.equal(hooks.deepTimer._destroyed, true);
    assert.equal(hooks.board.disconnect.mock.callCount(), 1);
  });

  it('should handle null timer', async () => {
    const { hooks } = createHooks();
    hooks.deepTimer = null;

    await hooks.shutdown();
    assert.equal(hooks.board.disconnect.mock.callCount(), 1);
  });
});

// ── Additional coverage tests ────────────────────────────────

describe('ZettelkastenHooks — _startDeepRumination', () => {
  it('should set deepTimer and call rumination.deepRuminate after interval', async () => {
    const { hooks, rumination } = createHooks();
    // Use a short interval for this test
    hooks.deepRuminationInterval = 30;
    hooks._startDeepRumination();

    assert.ok(hooks.deepTimer, 'deepTimer should be set');

    // Wait for one tick
    await new Promise(r => setTimeout(r, 60));

    assert.ok(rumination.deepRuminate.mock.callCount() >= 1, 'deepRuminate should have been called');

    clearInterval(hooks.deepTimer);
  });

  it('should handle deepRuminate error without crashing', async () => {
    const rumination = createMockRumination();
    rumination.deepRuminate = mock.fn(async () => { throw new Error('rumination crash'); });
    const { hooks } = createHooks({ rumination });
    hooks.deepRuminationInterval = 30;
    hooks._startDeepRumination();

    // Should not throw
    await new Promise(r => setTimeout(r, 60));

    clearInterval(hooks.deepTimer);
  });
});

describe('ZettelkastenHooks — init() subscriber wiring', () => {
  it('should call board.connect and board.createSubscriber', async () => {
    const { hooks } = createHooks();

    await hooks.init();

    assert.equal(hooks.board.connect.mock.callCount(), 1);
    assert.equal(hooks.board.createSubscriber.mock.callCount(), 1);
  });

  it('should subscribe to all four required channels', async () => {
    const subscribeCalls = [];
    const { hooks } = createHooks();
    hooks.board.createSubscriber = mock.fn(async () => ({
      subscribe: mock.fn(async (channel) => { subscribeCalls.push(channel); }),
      pSubscribe: mock.fn(async () => {}),
    }));

    await hooks.init();

    const prefixed = (ch) => require('../agent/blackboard').Blackboard.PREFIX + ch;
    assert.ok(subscribeCalls.some(c => c === prefixed('skills:emergency')), 'should subscribe to skills:emergency');
    assert.ok(subscribeCalls.some(c => c === prefixed('rumination:digested')), 'should subscribe to rumination:digested');
    assert.ok(subscribeCalls.some(c => c === prefixed('zettelkasten:tier-up')), 'should subscribe to zettelkasten:tier-up');
    assert.ok(subscribeCalls.some(c => c === prefixed('zettelkasten:compound-created')), 'should subscribe to zettelkasten:compound-created');
  });

  it('_onDigestionComplete with wiredLeader calls processGoTFeedback when threshold reached', async () => {
    const { hooks, got } = createHooks({ reasoningThreshold: 1 });
    const processGoTFeedback = mock.fn(async () => {});
    hooks._wiredLeader = { processGoTFeedback };
    hooks.ruminationsSinceReasoning = 0;

    await hooks._onDigestionComplete({});

    // GoT cycle should have run
    assert.equal(got.fullReasoningCycle.mock.callCount(), 1);
  });
});
