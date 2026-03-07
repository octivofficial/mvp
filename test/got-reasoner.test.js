/**
 * GoT Reasoner tests.
 * Tests graph construction, synergy discovery, optimal builds,
 * gap analysis, and evolution path prediction.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { GoTReasoner } = require('../agent/got-reasoner');

// ── Mock Helpers ────────────────────────────────────────────

function createMockZettelkasten(notes = {}) {
  return {
    getAllNotes: async () => notes,
    _linkKey: (a, b) => [a, b].sort().join('::'),
    recordUsage: async () => ({ tierUp: false }),
    getNote: async (id) => notes[id] || null,
    board: {
      setHashField: async () => {},
    },
    _writeVaultNote: async () => {},
  };
}

function createMockBoard(configStore = {}) {
  return {
    connect: async () => {},
    disconnect: async () => {},
    publish: async () => {},
    getConfig: async (key) => configStore[key] || null,
  };
}

function makeNote(id, overrides = {}) {
  return {
    id,
    name: id.replace(/_/g, ' '),
    tier: 'Novice',
    xp: 5,
    successRate: 0.8,
    errorType: null,
    tags: [],
    links: [],
    status: 'active',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('GoTReasoner — Constructor', () => {
  it('should initialize with zettelkasten reference', () => {
    const zk = createMockZettelkasten();
    const got = new GoTReasoner(zk);
    assert.equal(got.zk, zk);
    assert.equal(got.llmClient, null);
  });

  it('should accept optional llmClient and logger', () => {
    const zk = createMockZettelkasten();
    const mockLLM = { generate: async () => 'test' };
    const mockLogger = { log: () => {} };
    const got = new GoTReasoner(zk, { llmClient: mockLLM, logger: mockLogger });
    assert.equal(got.llmClient, mockLLM);
    assert.equal(got.logger, mockLogger);
  });
});

describe('GoTReasoner — buildGraph', () => {
  it('should build nodes and edges from zettelkasten notes', async () => {
    const notes = {
      dig: makeNote('dig', { links: ['place'], tags: ['mining'] }),
      place: makeNote('place', { links: ['dig'], tags: ['building'] }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard({
      'zettelkasten:links:dig::place': { strength: 0.7, coOccurrences: 5 },
    });

    const graph = await got.buildGraph();

    assert.ok(graph.nodes.dig);
    assert.ok(graph.nodes.place);
    assert.equal(graph.edges.length, 2); // dig→place + place→dig
    assert.equal(graph.adjacency.dig.length, 1);
    assert.equal(graph.adjacency.dig[0].target, 'place');
  });

  it('should skip deprecated notes', async () => {
    const notes = {
      active: makeNote('active'),
      old: makeNote('old', { status: 'deprecated' }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();

    const graph = await got.buildGraph();

    assert.ok(graph.nodes.active);
    assert.equal(graph.nodes.old, undefined);
  });

  it('should handle empty zettelkasten', async () => {
    const zk = createMockZettelkasten({});
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();

    const graph = await got.buildGraph();

    assert.deepEqual(graph.nodes, {});
    assert.deepEqual(graph.edges, []);
  });
});

describe('GoTReasoner — discoverSynergies', () => {
  it('should find unlinked skills with shared error type', async () => {
    const notes = {
      skill_a: makeNote('skill_a', { errorType: 'pathfinder:stuck', tags: ['nav'], successRate: 0.8 }),
      skill_b: makeNote('skill_b', { errorType: 'pathfinder:timeout', tags: ['nav'], successRate: 0.9 }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();
    got._saveReasoningTrace = async () => {}; // stub vault write

    const synergies = await got.discoverSynergies();

    assert.ok(synergies.length >= 1);
    const syn = synergies[0];
    assert.ok(syn.score >= 0.4);
    assert.ok(syn.reason.length > 0);
  });

  it('should ignore pairs below score threshold', async () => {
    const notes = {
      a: makeNote('a', { tags: [], successRate: 0.3 }),
      b: makeNote('b', { tags: [], successRate: 0.2 }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();
    got._saveReasoningTrace = async () => {};

    const synergies = await got.discoverSynergies();
    assert.equal(synergies.length, 0);
  });
});

describe('GoTReasoner — findOptimalBuilds', () => {
  it('should build from high-XP skills outward', async () => {
    const notes = {
      root: makeNote('root', { xp: 50, successRate: 0.9, links: ['leaf'] }),
      leaf: makeNote('leaf', { xp: 20, successRate: 0.8, links: ['root'] }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard({
      'zettelkasten:links:leaf::root': { strength: 0.8, coOccurrences: 10 },
    });
    got._saveReasoningTrace = async () => {};

    const builds = await got.findOptimalBuilds(3);

    assert.ok(builds.length >= 1);
    assert.ok(builds[0].skills.includes('root'));
    assert.ok(builds[0].totalXP > 0);
    assert.ok(builds[0].buildStrength > 0);
  });

  it('should filter out compound and low-success skills', async () => {
    const notes = {
      good: makeNote('good', { xp: 30, successRate: 0.7 }),
      compound: makeNote('compound', { xp: 40, successRate: 0.9, status: 'compound' }),
      weak: makeNote('weak', { xp: 10, successRate: 0.2 }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();
    got._saveReasoningTrace = async () => {};

    const builds = await got.findOptimalBuilds();

    // compound and weak should not be roots
    for (const build of builds) {
      assert.ok(!build.skills.includes('compound'));
      assert.ok(!build.skills.includes('weak'));
    }
  });
});

describe('GoTReasoner — identifyGaps', () => {
  it('should find error types with weak coverage', async () => {
    const notes = {
      s1: makeNote('s1', { errorType: 'dig:fail', xp: 3 }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();
    got._saveReasoningTrace = async () => {};

    const gaps = await got.identifyGaps();

    assert.ok(gaps.length >= 1);
    assert.equal(gaps[0].errorType, 'dig:fail');
    assert.ok(gaps[0].recommendation.includes('weak'));
  });

  it('should return empty for well-covered error types', async () => {
    const notes = {
      s1: makeNote('s1', { errorType: 'nav:stuck', xp: 50 }),
      s2: makeNote('s2', { errorType: 'nav:stuck', xp: 30 }),
      s3: makeNote('s3', { errorType: 'nav:stuck', xp: 20 }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();
    got._saveReasoningTrace = async () => {};

    const gaps = await got.identifyGaps();
    assert.equal(gaps.length, 0);
  });
});

describe('GoTReasoner — predictEvolutionPaths', () => {
  it('should calculate uses to Master for non-master skills', async () => {
    const notes = {
      s1: makeNote('s1', { tier: 'Apprentice', xp: 30, successRate: 0.8 }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();
    got._saveReasoningTrace = async () => {};

    const paths = await got.predictEvolutionPaths();

    assert.equal(paths.length, 1);
    assert.equal(paths[0].skill, 's1');
    assert.equal(paths[0].currentTier, 'Apprentice');
    assert.equal(paths[0].usesToMaster, Math.ceil((150 - 30) / 3)); // 40
    assert.equal(paths[0].bottleneck, 'needs_more_usage');
  });

  it('should skip Master and Grandmaster skills', async () => {
    const notes = {
      master: makeNote('master', { tier: 'Master', xp: 200 }),
      gm: makeNote('gm', { tier: 'Grandmaster', xp: 500 }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.board = createMockBoard();
    got._saveReasoningTrace = async () => {};

    const paths = await got.predictEvolutionPaths();
    assert.equal(paths.length, 0);
  });
});

describe('GoTReasoner — _explainSynergy', () => {
  it('should explain shared tags', () => {
    const got = new GoTReasoner(createMockZettelkasten());
    const a = { tags: ['nav', 'combat'], errorType: null, successRate: 0.5 };
    const b = { tags: ['nav'], errorType: null, successRate: 0.5 };
    const result = got._explainSynergy(a, b, ['nav']);
    assert.ok(result.includes('shared tags: nav'));
  });

  it('should explain same error type', () => {
    const got = new GoTReasoner(createMockZettelkasten());
    const a = { tags: [], errorType: 'dig:fail', successRate: 0.5 };
    const b = { tags: [], errorType: 'dig:fail', successRate: 0.5 };
    const result = got._explainSynergy(a, b, []);
    assert.ok(result.includes('same error type'));
  });

  it('should include both-successful note when both rates >= 0.7', () => {
    const got = new GoTReasoner(createMockZettelkasten());
    const a = { tags: [], errorType: 'nav:stuck', successRate: 0.8 };
    const b = { tags: [], errorType: 'nav:timeout', successRate: 0.9 };
    const result = got._explainSynergy(a, b, []);
    assert.ok(result.includes('both highly successful'));
  });

  it('should return default when no specific reason', () => {
    const got = new GoTReasoner(createMockZettelkasten());
    // Use different errorTypes so the equality check doesn't match
    const a = { tags: [], errorType: 'dig:fail', successRate: 0.3 };
    const b = { tags: [], errorType: 'nav:stuck', successRate: 0.3 };
    const result = got._explainSynergy(a, b, []);
    assert.equal(result, 'complementary skills');
  });
});

describe('GoTReasoner — _generateMermaidGraph empty', () => {
  it('should return early without calling fsp.writeFile when no skills exist', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'got-empty-graph-'));
    const zk = createMockZettelkasten({}); // empty
    const got = new GoTReasoner(zk);
    got.vaultDir = tmpDir;
    got.board = createMockBoard();

    // Patch fsp on the module level is complex — instead verify via side-effect:
    // _generateMermaidGraph returns undefined early when nodes.length === 0
    const result = await got._generateMermaidGraph();
    assert.equal(result, undefined, 'Should return undefined (early return) for empty graph');

    // Verify no Skill-Graph.md was created in this specific tmpDir parent
    // (early return means we never reach the writeFile call)
    const files = await fsp.readdir(tmpDir);
    assert.equal(files.length, 0, 'vaultDir should remain empty on early return');
  });
});

describe('GoTReasoner — fullReasoningCycle', () => {
  it('should run all 4 strategies and return a summary', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'got-cycle-'));
    const notes = {
      skill_x: makeNote('skill_x', { errorType: 'nav:stuck', xp: 5, successRate: 0.8, tags: ['nav'] }),
      skill_y: makeNote('skill_y', { errorType: 'nav:stuck', xp: 3, successRate: 0.7, tags: ['nav'] }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.vaultDir = tmpDir;
    got.board = createMockBoard();

    let published = false;
    got.board.publish = async (channel, _payload) => {
      if (channel === 'got:reasoning-complete') published = true;
    };

    const result = await got.fullReasoningCycle();

    assert.ok(result, 'Should return a result object');
    assert.ok('synergies' in result, 'Result should include synergies');
    assert.ok('optimalBuilds' in result, 'Result should include optimalBuilds');
    assert.ok('gaps' in result, 'Result should include gaps');
    assert.ok('evolutions' in result, 'Result should include evolutions');
    assert.ok('summary' in result, 'Result should include summary');
    assert.ok(typeof result.summary.totalSynergies === 'number');
    assert.ok(published, 'Should publish got:reasoning-complete to the board');
  });

  it('should handle an empty zettelkasten without throwing', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'got-cycle-empty-'));
    const zk = createMockZettelkasten({});
    const got = new GoTReasoner(zk);
    got.vaultDir = tmpDir;
    got.board = createMockBoard();
    got.board.publish = async () => {};

    const result = await got.fullReasoningCycle();
    assert.equal(result.summary.totalSynergies, 0);
    assert.equal(result.summary.totalGaps, 0);
    assert.equal(result.summary.closestToMaster, 'none');
  });
});

describe('GoTReasoner — shutdown', () => {
  it('should disconnect board', async () => {
    const zk = createMockZettelkasten();
    const got = new GoTReasoner(zk);
    let disconnected = false;
    got.board = { disconnect: async () => { disconnected = true; } };

    await got.shutdown();
    assert.ok(disconnected);
  });
});

describe('GoTReasoner — vault persistence', () => {
  it('uses fixed filenames without timestamps', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'got-vault-'));
    const zk = createMockZettelkasten();
    const got = new GoTReasoner(zk);
    got.vaultDir = tmpDir;

    await got._saveReasoningTrace('synergy-discovery', { test: true });
    const files = await fsp.readdir(tmpDir);
    assert.deepStrictEqual(files, ['synergy-discovery.md']);
    assert.ok(!files[0].includes('_2026'), 'should not have timestamp suffix');
  });

  it('writes valid YAML frontmatter', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'got-yaml-'));
    const zk = createMockZettelkasten();
    const got = new GoTReasoner(zk);
    got.vaultDir = tmpDir;

    await got._saveReasoningTrace('gap-analysis', { gaps: [] });
    const content = await fsp.readFile(path.join(tmpDir, 'gap-analysis.md'), 'utf-8');
    assert.ok(content.startsWith('---'));
    assert.ok(content.includes('strategy: "gap-analysis"'));
    assert.ok(content.includes('tags: ["got", "reasoning", "gap-analysis"]'));
    assert.ok(content.includes('date:'));
  });

  it('overwrites same file on repeated calls', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'got-overwrite-'));
    const zk = createMockZettelkasten();
    const got = new GoTReasoner(zk);
    got.vaultDir = tmpDir;

    await got._saveReasoningTrace('optimal-builds', { v: 1 });
    await got._saveReasoningTrace('optimal-builds', { v: 2 });
    const files = await fsp.readdir(tmpDir);
    assert.equal(files.length, 1);
    const content = await fsp.readFile(path.join(tmpDir, 'optimal-builds.md'), 'utf-8');
    assert.ok(content.includes('"v": 2'));
  });

  it('generates Mermaid skill graph', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'got-mermaid-'));
    // Create reasoning subdir to mimic vault structure
    const reasoningDir = path.join(tmpDir, '04-Skills', 'reasoning');
    await fsp.mkdir(reasoningDir, { recursive: true });

    const notes = {
      mine_wood: makeNote('mine_wood', { tier: 'Apprentice', xp: 15, links: ['craft_planks'] }),
      craft_planks: makeNote('craft_planks', { tier: 'Novice', xp: 5, links: ['mine_wood'] }),
    };
    const zk = createMockZettelkasten(notes);
    const got = new GoTReasoner(zk);
    got.vaultDir = reasoningDir;
    got.board = createMockBoard();

    await got._generateMermaidGraph();

    const graphPath = path.join(tmpDir, '04-Skills', 'Skill-Graph.md');
    const content = await fsp.readFile(graphPath, 'utf-8');
    assert.ok(content.includes('```mermaid'));
    assert.ok(content.includes('graph TD'));
    assert.ok(content.includes('mine_wood'));
    assert.ok(content.includes('craft_planks'));
    assert.ok(content.includes('tags: [graph, skills, auto-generated]'));
  });
});
