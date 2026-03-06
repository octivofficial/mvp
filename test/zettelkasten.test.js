/**
 * Zettelkasten Integration Tests
 *
 * Tests the full integration between:
 *   SkillZettelkasten → RuminationEngine → GoTReasoner → ZettelkastenHooks
 *
 * Requires Redis on port 6380 (same as other integration tests).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { SkillZettelkasten } = require('../agent/skill-zettelkasten');
const { RuminationEngine } = require('../agent/rumination-engine');
const { GoTReasoner } = require('../agent/got-reasoner');
const { ZettelkastenHooks } = require('../agent/zettelkasten-hooks');
const { Blackboard } = require('../agent/blackboard');

// Temp vault dir to avoid polluting real vault/
const TEMP_VAULT = path.join(os.tmpdir(), `octiv-zk-test-${Date.now()}`);

// Clean up Redis keys used by these tests
async function cleanZkKeys(board) {
  const client = board.client;
  const keys = await client.keys('octiv:zettelkasten:*');
  if (keys.length > 0) await client.del(keys);
  const linkKeys = await client.keys('octiv:zettelkasten:links:*');
  if (linkKeys.length > 0) await client.del(linkKeys);
  const configKeys = await client.keys('octiv:config:zettelkasten:*');
  if (configKeys.length > 0) await client.del(configKeys);
}

// ── SkillZettelkasten CRUD + XP ─────────────────────────────────────

describe('SkillZettelkasten — CRUD + XP', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'crud') });
    await zk.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('createNote should create an atomic note with Novice tier', async () => {
    const note = await zk.createNote({
      name: 'avoid_lava',
      code: 'bot.pathfinder.avoid("lava")',
      description: 'Avoid lava blocks',
      errorType: 'lava',
      agentId: 'builder-01',
    });

    assert.equal(note.name, 'avoid_lava');
    assert.equal(note.tier, 'Novice');
    assert.equal(note.xp, 0);
    assert.equal(note.uses, 0);
    assert.ok(note.tags.includes('atomic'));
  });

  it('getNote should retrieve a stored note', async () => {
    const note = await zk.getNote('avoid-lava');
    assert.ok(note);
    assert.equal(note.name, 'avoid_lava');
    assert.equal(note.id, 'avoid-lava');
  });

  it('recordUsage should add XP and update stats', async () => {
    const result = await zk.recordUsage('avoid-lava', true);
    assert.ok(result);
    assert.equal(result.xpGain, 3); // success = 3 XP
    assert.equal(result.note.uses, 1);
    assert.equal(result.note.successes, 1);
    assert.equal(result.note.xp, 3);
  });

  it('recordUsage with failure should give 1 XP', async () => {
    const result = await zk.recordUsage('avoid-lava', false);
    assert.equal(result.xpGain, 1);
    assert.equal(result.note.failures, 1);
    assert.equal(result.note.xp, 4); // 3 + 1
  });

  it('recordUsage should return null for non-existent skill', async () => {
    const result = await zk.recordUsage('does-not-exist', true);
    assert.equal(result, null);
  });
});

// ── XP Flow: Tier Progression ──────────────────────────────────────

describe('SkillZettelkasten — Full XP Flow (Novice → Apprentice)', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'xp-flow') });
    await zk.init();

    await zk.createNote({
      name: 'xp_test_skill',
      code: 'return true;',
      errorType: 'test',
      agentId: 'test',
    });
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should tier up from Novice to Apprentice after 10+ XP', async () => {
    // Need 10 XP for Apprentice. Success = 3 XP, so 4 successes = 12 XP
    let tieredUp = false;
    for (let i = 0; i < 4; i++) {
      const result = await zk.recordUsage('xp-test-skill', true);
      if (result.tieredUp) tieredUp = true;
    }

    assert.ok(tieredUp, 'Expected tier-up to occur');
    const note = await zk.getNote('xp-test-skill');
    assert.equal(note.tier, 'Apprentice');
    assert.equal(note.xp, 12);
  });
});

// ── RuminationEngine ──────────────────────────────────────────────

describe('RuminationEngine — Feed + Digest', () => {
  let zk, rum, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'rumination') });
    await zk.init();
    rum = new RuminationEngine(zk);
    await rum.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await rum.shutdown();
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('feed should buffer experiences', () => {
    rum.feed({ errorType: 'pathfinding', succeeded: true, skillUsed: 'nav-v1' });
    rum.feed({ errorType: 'pathfinding', succeeded: true, skillUsed: 'nav-v1' });
    rum.feed({ errorType: 'pathfinding', succeeded: false, skillUsed: 'nav-v1' });
    assert.equal(rum.rawBuffer.length, 3);
  });

  it('digest should process buffered experiences and produce insights', async () => {
    const result = await rum.digest();
    assert.ok(result.digested >= 3);
    assert.equal(rum.rawBuffer.length, 0, 'Buffer should be drained');
    assert.equal(rum.totalDigestions, 1);
  });

  it('digest with empty buffer should return 0', async () => {
    const result = await rum.digest();
    assert.equal(result.digested, 0);
    assert.equal(result.insights.length, 0);
  });
});

// ── GoTReasoner ──────────────────────────────────────────────────

describe('GoTReasoner — Graph + Synergies', () => {
  let zk, got, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'got') });
    await zk.init();
    got = new GoTReasoner(zk, { vaultDir: path.join(TEMP_VAULT, 'got', 'reasoning') });
    await got.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await got.shutdown();
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('buildGraph with empty Zettelkasten should return empty graph', async () => {
    const graph = await got.buildGraph();
    assert.equal(Object.keys(graph.nodes).length, 0);
    assert.equal(graph.edges.length, 0);
  });

  it('discoverSynergies with empty graph should return 0 synergies', async () => {
    const synergies = await got.discoverSynergies();
    assert.equal(synergies.length, 0);
  });

  it('buildGraph should include created notes', async () => {
    await zk.createNote({ name: 'skill_a', code: 'a()', errorType: 'nav', agentId: 'test' });
    await zk.createNote({ name: 'skill_b', code: 'b()', errorType: 'nav', agentId: 'test' });

    const graph = await got.buildGraph();
    assert.equal(Object.keys(graph.nodes).length, 2);
    assert.ok(graph.nodes['skill-a']);
    assert.ok(graph.nodes['skill-b']);
  });
});

// ── ZettelkastenHooks Wiring ──────────────────────────────────────

describe('ZettelkastenHooks — Wiring', () => {
  let zk, rum, got, hooks, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'hooks') });
    await zk.init();
    rum = new RuminationEngine(zk);
    await rum.init();
    got = new GoTReasoner(zk, { vaultDir: path.join(TEMP_VAULT, 'hooks', 'reasoning') });
    await got.init();
    hooks = new ZettelkastenHooks(zk, rum, got);
    await hooks.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await hooks.shutdown();
    await got.shutdown();
    await rum.shutdown();
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('wireToBuilder should feed rumination on _tryLearnedSkill', async () => {
    const mockBuilder = {
      id: 'builder-test',
      _tryLearnedSkill: async () => ({ skillName: 'test-skill', success: true, coSkills: [] }),
      _selfImprove: async () => true,
    };

    hooks.wireToBuilder(mockBuilder);

    // Call the wrapped method
    await mockBuilder._tryLearnedSkill(new Error('test'));

    // Rumination buffer should have been fed
    assert.ok(rum.rawBuffer.length >= 1, 'Rumination should have received experience');
    const last = rum.rawBuffer[rum.rawBuffer.length - 1];
    assert.equal(last.agentId, 'builder-test');
    assert.equal(last.succeeded, true);
  });

  it('wireToLeader should trigger GoT and pass result to leader', async () => {
    let gotCalled = false;
    let feedbackReceived = null;
    const originalCycle = got.fullReasoningCycle.bind(got);
    got.fullReasoningCycle = async () => {
      gotCalled = true;
      return {
        synergies: [], gaps: [], evolutions: [],
        summary: { totalSynergies: 0, totalGaps: 0, criticalGaps: 0, closestToMaster: 'none' },
      };
    };

    const mockLeader = {
      triggerGroupReflexion: async () => ({ entries: 3, agents: 3 }),
      processGoTFeedback: async (result) => { feedbackReceived = result; return { actions: [] }; },
    };

    hooks.wireToLeader(mockLeader);
    await mockLeader.triggerGroupReflexion();

    assert.ok(gotCalled, 'GoT fullReasoningCycle should have been called');
    assert.ok(feedbackReceived, 'processGoTFeedback should have received GoT result');
    assert.equal(feedbackReceived.summary.totalSynergies, 0);

    // Restore
    got.fullReasoningCycle = originalCycle;
  });

  it('wireToSkillPipeline should create Zettelkasten note on deploy', async () => {
    const mockPipeline = {
      deploySkill: async (json) => ({ success: true, skill: json.name }),
      updateSuccessRate: async () => ({}),
    };

    hooks.wireToSkillPipeline(mockPipeline);

    await mockPipeline.deploySkill({
      name: 'hooked_skill',
      code: 'return 42;',
      description: 'Test hook deployment',
      errorType: 'test',
    });

    // Note should exist in Zettelkasten
    const note = await zk.getNote('hooked-skill');
    assert.ok(note, 'Note should have been created by hook');
    assert.equal(note.name, 'hooked_skill');
  });
});

// ── ZettelkastenHooks — newSkill Guard ────────────────────────────

describe('ZettelkastenHooks — newSkill Guard', () => {
  let hooks;

  before(async () => {
    // Minimal hooks with stubs (no Redis needed for _onSkillDeployed)
    const stubZk = { getStats: async () => ({}) };
    const stubRum = { getStats: () => ({}), init: async () => {} };
    const stubGot = { init: async () => {} };
    hooks = new ZettelkastenHooks(stubZk, stubRum, stubGot);
    // Don't call init() — avoid Redis subscription for this unit test
  });

  it('should ignore events without newSkill field', async () => {
    let logged = false;
    hooks.logger = { logEvent: async () => { logged = true; } };

    // Safety alert: has failureType but no newSkill
    await hooks._onSkillDeployed({ failureType: 'fall', triggerSkillCreation: true });

    assert.equal(logged, false, 'Should not log when newSkill is missing');
  });

  it('should process events with valid newSkill', async () => {
    let logged = false;
    hooks.logger = { logEvent: async () => { logged = true; } };

    await hooks._onSkillDeployed({ newSkill: 'avoid_lava_v1' });

    assert.equal(logged, true, 'Should log when newSkill is present');
  });
});

// ── Compound Skill Creation ─────────────────────────────────────

describe('SkillZettelkasten — Compound Creation', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'compound') });
    await zk.init();

    // Create two skills
    await zk.createNote({ name: 'dig_down', code: 'dig()', errorType: 'mining', agentId: 'test' });
    await zk.createNote({ name: 'place_torch', code: 'torch()', errorType: 'mining', agentId: 'test' });
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should create compound note after 5+ co-occurrences with 70%+ strength', async () => {
    // Simulate 5 successful co-occurrences + 1 failure (5/6 = 83% strength)
    for (let i = 0; i < 5; i++) {
      await zk.recordUsage('dig-down', true, { coSkills: ['place-torch'] });
    }
    await zk.recordUsage('dig-down', false, { coSkills: ['place-torch'] });

    // Check if compound was created
    const compound = await zk.getNote('compound-dig-down-place-torch');
    // The compound key is sorted alphabetically: dig-down vs place-torch
    // _linkKey sorts: ['dig-down', 'place-torch'] → 'dig-down::place-torch'
    // _suggestCompound: `compound_${skillIdA}_${skillIdB}` → compound_dig-down_place-torch
    // But slugified: compound-dig-down-place-torch
    assert.ok(compound, 'Compound note should have been created');
    assert.ok(compound.compoundOf, 'Should have compoundOf field');
    assert.equal(compound.status, 'compound');
    assert.ok(compound.xp > 0, 'Compound should inherit XP from parents');
  });
});

// ── SkillZettelkasten — deprecateNote ────────────────────────────

describe('SkillZettelkasten — deprecateNote', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'deprecate') });
    await zk.init();

    await zk.createNote({
      name: 'bad_skill',
      code: 'fail()',
      errorType: 'test',
      agentId: 'test',
    });
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should set status to deprecated and record deprecatedAt', async () => {
    const before = Date.now();
    const note = await zk.deprecateNote('bad-skill');
    assert.ok(note, 'Should return the deprecated note');
    assert.equal(note.status, 'deprecated');
    assert.ok(note.deprecatedAt >= before, 'deprecatedAt should be set');
    assert.equal(note.deprecationReason, 'low_success_rate');
  });

  it('should persist deprecated status in Redis', async () => {
    const fetched = await zk.getNote('bad-skill');
    assert.ok(fetched, 'Note should still exist in Redis');
    assert.equal(fetched.status, 'deprecated');
  });

  it('should return null for non-existent note', async () => {
    const result = await zk.deprecateNote('does-not-exist');
    assert.equal(result, null);
  });

  it('should accept a custom deprecation reason', async () => {
    await zk.createNote({
      name: 'another_bad_skill',
      code: 'bad()',
      errorType: 'test',
      agentId: 'test',
    });
    const note = await zk.deprecateNote('another-bad-skill', 'manually_retired');
    assert.ok(note);
    assert.equal(note.deprecationReason, 'manually_retired');
  });
});

// ── SkillZettelkasten — getByTier ────────────────────────────────

describe('SkillZettelkasten — getByTier', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'getbytier') });
    await zk.init();

    // Create a Novice note and an Apprentice note (by pumping XP)
    await zk.createNote({ name: 'novice_skill', code: 'n()', errorType: 'test', agentId: 'test' });
    await zk.createNote({ name: 'apprentice_skill', code: 'a()', errorType: 'test', agentId: 'test' });

    // Pump apprentice_skill to Apprentice tier (need 10+ XP: 4 successes = 12 XP)
    for (let i = 0; i < 4; i++) {
      await zk.recordUsage('apprentice-skill', true);
    }
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should return only skills at the specified tier', async () => {
    const novices = await zk.getByTier('Novice');
    assert.ok(novices.length >= 1, 'Should find at least one Novice skill');
    for (const note of novices) {
      assert.equal(note.tier, 'Novice');
      assert.equal(note.status, 'active');
    }
  });

  it('should exclude deprecated notes from tier results', async () => {
    await zk.deprecateNote('novice-skill');
    const novices = await zk.getByTier('Novice');
    const ids = novices.map(n => n.id);
    assert.ok(!ids.includes('novice-skill'), 'Deprecated note should be excluded');
  });
});

// ── SkillZettelkasten — getStrongestLinks ─────────────────────────

describe('SkillZettelkasten — getStrongestLinks', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'stronglinks') });
    await zk.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should return empty array when no notes exist', async () => {
    const links = await zk.getStrongestLinks();
    assert.deepEqual(links, []);
  });

  it('should return links sorted by strength after co-occurrences', async () => {
    await zk.createNote({ name: 'link_skill_a', code: 'a()', errorType: 'mining', agentId: 'test' });
    await zk.createNote({ name: 'link_skill_b', code: 'b()', errorType: 'mining', agentId: 'test' });

    // Record 6 co-occurrences: 5 success + 1 failure → strength ~0.83
    for (let i = 0; i < 5; i++) {
      await zk.recordUsage('link-skill-a', true, { coSkills: ['link-skill-b'] });
    }
    await zk.recordUsage('link-skill-a', false, { coSkills: ['link-skill-b'] });

    const links = await zk.getStrongestLinks(0.5);
    assert.ok(links.length >= 1, 'Should find at least one strong link');
    assert.ok(links[0].strength >= 0.5, 'Link strength should meet minimum threshold');

    // Verify sorted descending
    for (let i = 1; i < links.length; i++) {
      assert.ok(links[i - 1].strength >= links[i].strength, 'Links should be sorted by strength descending');
    }
  });
});

// ── Vault File Persistence ──────────────────────────────────────

describe('SkillZettelkasten — Vault Persistence', () => {
  let zk, cleanupBoard;

  before(async () => {
    cleanupBoard = new Blackboard();
    await cleanupBoard.connect();
    await cleanZkKeys(cleanupBoard);

    zk = new SkillZettelkasten({ vaultDir: path.join(TEMP_VAULT, 'vault-persist') });
    await zk.init();
  });

  after(async () => {
    await cleanZkKeys(cleanupBoard);
    await zk.shutdown();
    await cleanupBoard.disconnect();
  });

  it('should write .md file to vault on createNote', async () => {
    await zk.createNote({
      name: 'vault_test',
      code: 'test()',
      errorType: 'test',
      agentId: 'test',
    });

    const filepath = path.join(TEMP_VAULT, 'vault-persist', 'atomic', 'vault-test.md');
    assert.ok(fs.existsSync(filepath), 'Vault file should exist');

    const content = fs.readFileSync(filepath, 'utf-8');
    assert.ok(content.includes('vault_test'), 'File should contain skill name');
    assert.ok(content.includes('Novice'), 'File should contain tier');
  });
});
