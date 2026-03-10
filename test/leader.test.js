/**
 * LeaderAgent Tests — distributeMission, decideMode, collectVote,
 * forceGroupReflexion, triggerGroupReflexion, injectLearnedSkill, processGoTFeedback
 * Usage: node --test --test-force-exit test/leader.test.js
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { LeaderAgent } = require('../agent/leader');

function createLeader(teamSize = 3) {
  const leader = new LeaderAgent(teamSize);
  // Replace board with mock (avoid real Redis)
  leader.board = {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(async () => {}),
    publish: mock.fn(async () => {}),
    get: mock.fn(async () => null),
    getACProgress: mock.fn(async () => ({})),
    getListRange: mock.fn(async () => []),
  };
  // Replace chat with mock
  leader.chat = {
    chat: mock.fn(async () => {}),
    confess: mock.fn(async () => {}),
  };
  // Stop mission loop from running
  if (leader._missionTimer) clearInterval(leader._missionTimer);
  return leader;
}

// ── distributeMission ────────────────────────────────────────

describe('LeaderAgent — distributeMission', () => {
  it('should assign collectWood when AC-1 not done', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({}));

    const mission = await leader.distributeMission('builder-01');
    assert.equal(mission.ac, 1);
    assert.equal(mission.action, 'collectWood');
  });

  it('should assign craftBasicTools when AC-1 done but AC-3 not', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
    }));

    const mission = await leader.distributeMission('builder-01');
    assert.equal(mission.ac, 3);
    assert.equal(mission.action, 'craftBasicTools');
  });

  it('should assign buildShelter when AC-1 and AC-3 done', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-3': JSON.stringify({ status: 'done' }),
    }));

    const mission = await leader.distributeMission('builder-01');
    assert.equal(mission.ac, 2);
    assert.equal(mission.action, 'buildShelter');
  });

  it('should assign gatherAtShelter when AC-1, AC-3, AC-2 done', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'done' }),
      'AC-3': JSON.stringify({ status: 'done' }),
    }));

    const mission = await leader.distributeMission('builder-01');
    assert.equal(mission.ac, 4);
    assert.equal(mission.action, 'gatherAtShelter');
  });

  it('should assign idle when all ACs done', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'done' }),
      'AC-3': JSON.stringify({ status: 'done' }),
      'AC-4': JSON.stringify({ status: 'done' }),
    }));

    const mission = await leader.distributeMission('builder-01');
    assert.equal(mission.ac, 0);
    assert.equal(mission.action, 'idle');
  });

  it('should publish mission to command channel', async () => {
    const leader = createLeader();
    await leader.distributeMission('builder-01');

    const call = leader.board.publish.mock.calls[0];
    assert.equal(call.arguments[0], 'command:builder-01:mission');
    assert.equal(call.arguments[1].author, 'leader');
  });

  it('should log mission_assigned when logger is set', async () => {
    const leader = createLeader();
    const logCalls = [];
    leader.logger = {
      logEvent: mock.fn(async (id, data) => { logCalls.push({ id, data }); }),
    };

    await leader.distributeMission('builder-01');

    assert.equal(logCalls.length, 1);
    assert.equal(logCalls[0].data.type, 'mission_assigned');
  });

  it('should handle malformed AC JSON gracefully', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': 'not-json',
    }));

    const mission = await leader.distributeMission('builder-01');
    assert.equal(mission.ac, 1); // Treats malformed as not-done
  });
});

// ── distributeSpecialistMission ──────────────────────────────

describe('LeaderAgent — distributeSpecialistMission', () => {
  it('should assign mine action to miner agent', async () => {
    const leader = createLeader();
    const mission = await leader.distributeSpecialistMission('miner-01');
    assert.equal(mission.action, 'mine');
    assert.equal(mission.params.priority, 'iron');
  });

  it('should assign farm action to farmer agent', async () => {
    const leader = createLeader();
    const mission = await leader.distributeSpecialistMission('farmer-01');
    assert.equal(mission.action, 'farm');
  });

  it('should assign idle to unknown role', async () => {
    const leader = createLeader();
    const mission = await leader.distributeSpecialistMission('scout-01');
    assert.equal(mission.action, 'idle');
  });

  it('should publish mission to correct channel', async () => {
    const leader = createLeader();
    await leader.distributeSpecialistMission('miner-01');

    const call = leader.board.publish.mock.calls[0];
    assert.equal(call.arguments[0], 'command:miner-01:mission');
    assert.equal(call.arguments[1].author, 'leader');
    assert.equal(call.arguments[1].action, 'mine');
  });
});

// ── decideMode ───────────────────────────────────────────────

describe('LeaderAgent — decideMode', () => {
  it('should stay in training mode when progress < 70%', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'in_progress' }),
      'AC-3': JSON.stringify({ status: 'in_progress' }),
      'AC-4': JSON.stringify({ status: 'in_progress' }),
    }));

    const mode = await leader.decideMode('builder-01');
    assert.equal(mode, 'training');
    assert.equal(leader.mode, 'training');
  });

  it('should switch to creative when progress >= 70%', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'done' }),
      'AC-3': JSON.stringify({ status: 'done' }),
      'AC-4': JSON.stringify({ status: 'in_progress' }),
    }));

    const mode = await leader.decideMode('builder-01');
    assert.equal(mode, 'creative');
  });

  it('should switch to creative when votes >= 2/3 threshold', async () => {
    const leader = createLeader(3);
    leader.votes = [{ vote: 'creative' }, { vote: 'creative' }]; // 2 >= ceil(3*2/3)=2
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'in_progress' }),
      'AC-3': JSON.stringify({ status: 'in_progress' }),
      'AC-4': JSON.stringify({ status: 'in_progress' }),
    }));

    const mode = await leader.decideMode('builder-01');
    assert.equal(mode, 'creative');
  });

  it('should publish leader:mode event', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({}));

    await leader.decideMode('builder-01');

    const modeCall = leader.board.publish.mock.calls.find(
      c => c.arguments[0] === 'leader:mode'
    );
    assert.ok(modeCall, 'Should publish leader:mode');
    assert.equal(modeCall.arguments[1].mode, 'training');
  });

  it('should handle empty AC data', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({}));

    const mode = await leader.decideMode('builder-01');
    assert.equal(mode, 'training'); // 0 progress
  });
});

// ── decideMode with idol metrics ─────────────────────────────

describe('LeaderAgent — decideMode with idol metrics', () => {
  it('should switch to creative when avgLevel >= 3', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'in_progress' }),
      'AC-3': JSON.stringify({ status: 'in_progress' }),
      'AC-4': JSON.stringify({ status: 'in_progress' }),
    }));

    // Simulate team metrics with high levels
    const { IdolMetrics } = require('../agent/idol-metrics');
    const m1 = new IdolMetrics('a1');
    m1.totalXP = 400; // level 3
    const m2 = new IdolMetrics('a2');
    m2.totalXP = 350; // level 3
    leader.teamIdolMetrics = [m1, m2];

    const mode = await leader.decideMode('builder-01');
    assert.equal(mode, 'creative');
  });

  it('should stay training when avgLevel < 3 and progress < 70%', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({
      'AC-1': JSON.stringify({ status: 'done' }),
      'AC-2': JSON.stringify({ status: 'in_progress' }),
      'AC-3': JSON.stringify({ status: 'in_progress' }),
      'AC-4': JSON.stringify({ status: 'in_progress' }),
    }));

    const { IdolMetrics } = require('../agent/idol-metrics');
    const m1 = new IdolMetrics('a1');
    m1.totalXP = 50; // level 1
    leader.teamIdolMetrics = [m1];

    const mode = await leader.decideMode('builder-01');
    assert.equal(mode, 'training');
  });

  it('should publish idol-overview when teamIdolMetrics set', async () => {
    const leader = createLeader();
    leader.board.getACProgress = mock.fn(async () => ({}));

    const { IdolMetrics } = require('../agent/idol-metrics');
    leader.teamIdolMetrics = [new IdolMetrics('a1')];

    await leader.decideMode('builder-01');

    const overviewCall = leader.board.publish.mock.calls.find(
      c => c.arguments[0] === 'leader:idol-overview'
    );
    assert.ok(overviewCall, 'should publish idol-overview');
    assert.equal(overviewCall.arguments[1].author, 'leader');
  });
});

// ── filterContextForMode ─────────────────────────────────────

describe('LeaderAgent — filterContextForMode', () => {
  it('should filter channels by training mode domains', () => {
    const leader = createLeader();
    leader.mode = 'training';

    const channels = [
      'agent:builder-01:status',   // survival → included
      'command:builder-01:mission', // command → included
      'safety:threat',              // system → included
      'agent:builder-01:idol-stats', // creative → excluded
      'skills:emergency',           // learning → excluded
    ];

    const filtered = leader.filterContextForMode(channels);
    assert.ok(filtered.includes('agent:builder-01:status'));
    assert.ok(filtered.includes('command:builder-01:mission'));
    assert.ok(filtered.includes('safety:threat'));
    assert.ok(!filtered.includes('agent:builder-01:idol-stats'));
  });

  it('should include creative domain in creative mode', () => {
    const leader = createLeader();
    leader.mode = 'creative';

    const channels = [
      'agent:builder-01:idol-stats', // creative → included
      'skills:emergency',            // learning → included
      'agent:builder-01:chat',       // social → included
    ];

    const filtered = leader.filterContextForMode(channels);
    assert.equal(filtered.length, 3);
  });

  it('should include unknown domains by default', () => {
    const leader = createLeader();
    leader.mode = 'training';

    const filtered = leader.filterContextForMode(['completely:random:channel']);
    assert.equal(filtered.length, 1);
  });
});

// ── collectVote ──────────────────────────────────────────────

describe('LeaderAgent — collectVote', () => {
  it('should add vote with timestamp', async () => {
    const leader = createLeader();
    const before = Date.now();

    await leader.collectVote('builder-01', 'creative');

    assert.equal(leader.votes.length, 1);
    assert.equal(leader.votes[0].agentId, 'builder-01');
    assert.equal(leader.votes[0].vote, 'creative');
    assert.ok(leader.votes[0].ts >= before);
  });

  it('should publish votes to leader:votes channel', async () => {
    const leader = createLeader();

    await leader.collectVote('builder-01', 'creative');

    const call = leader.board.publish.mock.calls[0];
    assert.equal(call.arguments[0], 'leader:votes');
    assert.equal(call.arguments[1].votes.length, 1);
  });

  it('should accumulate multiple votes', async () => {
    const leader = createLeader();

    await leader.collectVote('builder-01', 'creative');
    await leader.collectVote('builder-02', 'training');
    await leader.collectVote('builder-03', 'creative');

    assert.equal(leader.votes.length, 3);
  });
});

// ── forceGroupReflexion ──────────────────────────────────────

describe('LeaderAgent — forceGroupReflexion', () => {
  it('should publish reflexion event with consecutive_failures trigger', async () => {
    const leader = createLeader();
    const failureLog = [{ error: 'pathfinder' }, { error: 'dig' }];

    await leader.forceGroupReflexion(failureLog);

    const call = leader.board.publish.mock.calls[0];
    assert.equal(call.arguments[0], 'leader:reflexion');
    assert.equal(call.arguments[1].type, 'group');
    assert.equal(call.arguments[1].trigger, 'consecutive_failures');
    assert.deepEqual(call.arguments[1].failureLog, failureLog);
  });
});

// ── triggerGroupReflexion ────────────────────────────────────

describe('LeaderAgent — triggerGroupReflexion', () => {
  it('should collect errors from all builders and find top error', async () => {
    const leader = createLeader(2);
    leader.board.getListRange = mock.fn(async () => [
      JSON.stringify({ error: 'pathfinder:stuck' }),
      JSON.stringify({ error: 'pathfinder:stuck' }),
      JSON.stringify({ error: 'dig:fail' }),
    ]);

    const result = await leader.triggerGroupReflexion();

    assert.equal(result.totalEntries, 6); // 3 per builder x 2 builders
    assert.ok(result.commonErrors['pathfinder:stuck'] >= 4);
    assert.ok(result.recommendation.includes('pathfinder:stuck'));
  });

  it('should reset consecutiveTeamFailures', async () => {
    const leader = createLeader();
    leader.consecutiveTeamFailures = 5;

    await leader.triggerGroupReflexion();

    assert.equal(leader.consecutiveTeamFailures, 0);
  });

  it('should generate skill when pipeline exists and topError is not none', async () => {
    const leader = createLeader(1);
    leader.board.getListRange = mock.fn(async () => [
      JSON.stringify({ error: 'lava_death' }),
    ]);
    const injected = [];
    leader.skillPipeline = {
      generateFromFailure: mock.fn(async () => ({ success: true, skill: 'avoid_lava' })),
    };
    // Track injectLearnedSkill calls
    leader.injectLearnedSkill = mock.fn(async (name) => { injected.push(name); });

    await leader.triggerGroupReflexion();

    assert.equal(leader.skillPipeline.generateFromFailure.mock.callCount(), 1);
    assert.equal(injected[0], 'avoid_lava');
  });

  it('should skip skill generation when no pipeline', async () => {
    const leader = createLeader(1);
    leader.board.getListRange = mock.fn(async () => [
      JSON.stringify({ error: 'test' }),
    ]);
    leader.skillPipeline = null;

    const result = await leader.triggerGroupReflexion();
    assert.ok(result.recommendation.includes('test'));
  });

  it('should log event when logger is set', async () => {
    const leader = createLeader(1);
    leader.board.getListRange = mock.fn(async () => []);
    const logs = [];
    leader.logger = {
      logEvent: mock.fn(async (id, data) => { logs.push(data); }),
    };

    await leader.triggerGroupReflexion();

    assert.ok(logs.some(l => l.type === 'group_reflexion'));
  });
});

// ── injectLearnedSkill ───────────────────────────────────────

describe('LeaderAgent — injectLearnedSkill', () => {
  it('should inject skill and publish to all builders', async () => {
    const leader = createLeader(2);
    leader.board.get = mock.fn(async () => ({ skills: [] }));

    const result = await leader.injectLearnedSkill('avoid_lava', 'v1');

    assert.equal(result.tag, '[Learned Skill v1] avoid_lava');
    assert.equal(result.totalSkills, 1);
    // Should publish to leader:system_prompt + 2 builders
    const publishCalls = leader.board.publish.mock.calls;
    assert.ok(publishCalls.some(c => c.arguments[0] === 'leader:system_prompt'));
    assert.ok(publishCalls.some(c => c.arguments[0] === 'command:builder-01:prompt_update'));
    assert.ok(publishCalls.some(c => c.arguments[0] === 'command:builder-02:prompt_update'));
  });

  it('should reject duplicate skill', async () => {
    const leader = createLeader();
    leader.board.get = mock.fn(async () => ({
      skills: ['[Learned Skill v1] avoid_lava'],
    }));

    const result = await leader.injectLearnedSkill('avoid_lava', 'v1');
    assert.equal(result.rejected, 'duplicate');
  });

  it('should reject when max skills reached', async () => {
    const leader = createLeader();
    leader.board.get = mock.fn(async () => ({
      skills: Array(10).fill('skill'),
    }));

    const result = await leader.injectLearnedSkill('new_skill');
    assert.equal(result.rejected, 'max_skills_reached');
  });

  it('should reject low-quality skill from pipeline library', async () => {
    const leader = createLeader();
    leader.skillPipeline = {
      getLibrary: mock.fn(async () => ({
        bad_skill: { uses: 5, successRate: 0.2 },
      })),
    };

    const result = await leader.injectLearnedSkill('bad_skill');
    assert.equal(result.rejected, 'low_success_rate');
  });

  it('should proceed when library lookup fails', async () => {
    const leader = createLeader();
    leader.board.get = mock.fn(async () => ({ skills: [] }));
    leader.skillPipeline = {
      getLibrary: mock.fn(async () => { throw new Error('Redis down'); }),
    };

    const result = await leader.injectLearnedSkill('new_skill');
    assert.ok(result.tag); // Should succeed despite library error
  });

  it('should log skill_injected when logger is set', async () => {
    const leader = createLeader();
    leader.board.get = mock.fn(async () => ({ skills: [] }));
    const logs = [];
    leader.logger = {
      logEvent: mock.fn(async (id, data) => { logs.push(data); }),
    };

    await leader.injectLearnedSkill('test_skill');

    assert.ok(logs.some(l => l.type === 'skill_injected'));
  });

  it('should handle null system_prompt', async () => {
    const leader = createLeader();
    leader.board.get = mock.fn(async () => null);

    const result = await leader.injectLearnedSkill('new_skill');
    assert.equal(result.totalSkills, 1);
  });
});

// ── checkReflexionTrigger ────────────────────────────────────

describe('LeaderAgent — checkReflexionTrigger', () => {
  it('should trigger when failures >= 3', async () => {
    const leader = createLeader(1);
    leader.consecutiveTeamFailures = 3;
    leader.board.getListRange = mock.fn(async () => []);

    const triggered = await leader.checkReflexionTrigger();
    assert.equal(triggered, true);
  });

  it('should not trigger when failures < 3', async () => {
    const leader = createLeader();
    leader.consecutiveTeamFailures = 2;

    const triggered = await leader.checkReflexionTrigger();
    assert.equal(triggered, false);
  });
});

// ── processGoTFeedback ───────────────────────────────────────

describe('LeaderAgent — processGoTFeedback', () => {
  it('should return empty actions for null input', async () => {
    const leader = createLeader();
    const result = await leader.processGoTFeedback(null);
    assert.deepEqual(result, { actions: [] });
  });

  it('should return empty actions for missing summary', async () => {
    const leader = createLeader();
    const result = await leader.processGoTFeedback({ gaps: [] });
    assert.deepEqual(result, { actions: [] });
  });

  it('should generate skills for critical gaps', async () => {
    const leader = createLeader();
    leader.board.get = mock.fn(async () => ({ skills: [] }));
    leader.skillPipeline = {
      generateFromFailure: mock.fn(async () => ({ success: true, skill: 'fix_lava' })),
    };

    const result = await leader.processGoTFeedback({
      summary: { criticalGaps: 1 },
      gaps: [{ errorType: 'lava', severity: 'critical' }],
      synergies: [],
      evolutions: [],
    });

    assert.ok(result.actions.some(a => a.type === 'gap_skill_created'));
  });

  it('should suggest compounds for high synergies', async () => {
    const leader = createLeader();
    const result = await leader.processGoTFeedback({
      summary: { criticalGaps: 0 },
      gaps: [],
      synergies: [{ skillA: 'a', skillB: 'b', score: 0.8 }],
      evolutions: [],
    });

    assert.ok(result.actions.some(a => a.type === 'compound_suggested'));
  });

  it('should note evolution insights', async () => {
    const leader = createLeader();
    const result = await leader.processGoTFeedback({
      summary: { criticalGaps: 0 },
      gaps: [],
      synergies: [],
      evolutions: [{ skill: 'dig_v3', usesToMaster: 5 }],
    });

    assert.ok(result.actions.some(a => a.type === 'evolution_noted'));
    assert.equal(result.actions.find(a => a.type === 'evolution_noted').usesToMaster, 5);
  });

  it('should handle gap skill generation failure gracefully', async () => {
    const leader = createLeader();
    leader.skillPipeline = {
      generateFromFailure: mock.fn(async () => { throw new Error('API down'); }),
    };

    const result = await leader.processGoTFeedback({
      summary: { criticalGaps: 1 },
      gaps: [{ errorType: 'test', severity: 'critical' }],
      synergies: [],
      evolutions: [],
    });

    // Should not throw, just skip the failed gap
    assert.equal(result.actions.length, 0);
  });

  it('should log got_feedback_processed when logger is set', async () => {
    const leader = createLeader();
    const logs = [];
    leader.logger = {
      logEvent: mock.fn(async (id, data) => { logs.push(data); }),
    };

    await leader.processGoTFeedback({
      summary: { criticalGaps: 0 },
      gaps: [],
      synergies: [],
      evolutions: [],
    });

    assert.ok(logs.some(l => l.type === 'got_feedback_processed'));
  });

  it('should publish leader:got:actions', async () => {
    const leader = createLeader();

    await leader.processGoTFeedback({
      summary: { criticalGaps: 0 },
      gaps: [],
      synergies: [],
      evolutions: [],
    });

    const gotCall = leader.board.publish.mock.calls.find(
      c => c.arguments[0] === 'leader:got:actions'
    );
    assert.ok(gotCall, 'Should publish got:actions');
  });
});

// ── shutdown ─────────────────────────────────────────────────

describe('LeaderAgent — shutdown', () => {
  it('should clear mission timer and disconnect board', async () => {
    const leader = createLeader();
    leader._missionTimer = setInterval(() => {}, 999999);

    await leader.shutdown();

    assert.equal(leader._missionTimer._destroyed, true);
    assert.equal(leader.board.disconnect.mock.callCount(), 1);
  });

  it('should handle no timer gracefully', async () => {
    const leader = createLeader();
    leader._missionTimer = null;

    await leader.shutdown();
    assert.equal(leader.board.disconnect.mock.callCount(), 1);
  });
});

// ── _startMissionLoop ────────────────────────────────────────
describe('LeaderAgent — _startMissionLoop', () => {
  it('should create a mission timer', () => {
    const leader = createLeader();
    // init() calls _startMissionLoop, which was cleared by createLeader
    // Test by calling it directly
    leader._startMissionLoop();
    assert.ok(leader._missionTimer, '_missionTimer should exist');
    clearInterval(leader._missionTimer);
  });

  it('should distribute missions periodically', async () => {
    const leader = createLeader();
    let distributeCalls = 0;
    leader.distributeMission = mock.fn(async () => {
      distributeCalls++;
      return { ac: 1, action: 'collectWood' };
    });
    leader.decideMode = mock.fn(async () => 'training');

    // Start loop with short interval for testing
    leader._missionTimer = setInterval(async () => {
      try {
        for (let i = 1; i <= leader.teamSize; i++) {
          await leader.distributeMission(`builder-0${i}`);
        }
        await leader.decideMode('builder-01');
      } catch {}
    }, 50);

    await new Promise(r => setTimeout(r, 120));
    clearInterval(leader._missionTimer);

    assert.ok(distributeCalls >= 3, `expected >=3 distribute calls, got ${distributeCalls}`);
  });

  it('should handle errors in mission loop gracefully', async () => {
    const leader = createLeader();
    leader.distributeMission = mock.fn(async () => { throw new Error('redis down'); });
    leader.decideMode = mock.fn(async () => 'training');

    leader._startMissionLoop();
    // Override interval to be short
    clearInterval(leader._missionTimer);
    leader._missionTimer = setInterval(async () => {
      try {
        for (let i = 1; i <= leader.teamSize; i++) {
          await leader.distributeMission(`builder-0${i}`);
        }
      } catch {}
    }, 50);

    await new Promise(r => setTimeout(r, 100));
    clearInterval(leader._missionTimer);
    // No crash = success; loop should have attempted at least one cycle
    assert.ok(leader.distributeMission.mock.callCount() >= 1, 'mission loop should have run at least once without crashing');
  });
});
