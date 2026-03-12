/**
 * ReflexionEngine Unit Tests
 * Tests multi-LLM routing, cost guardrails, intent handling, and RAG augmentation.
 * Usage: node --test test/reflexion-engine.test.js
 *
 * IMPORTANT: No real Redis or API calls — all I/O is mocked via injection.
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const { ReflexionEngine, DEFAULT_CONFIG } = require('../agent/ReflexionEngine');

// ── Mock Helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a mock Blackboard that never touches Redis.
 * board.createSubscriber() returns a subscriber whose subscribe() is a no-op
 * so that retrieveKnowledge() resolves null via timeout (but we override
 * retrieveKnowledge in tests that call callLLM with normal severity).
 */
function createMockBoard(overrides = {}) {
  return {
    connect: async () => {},
    publish: mock.fn(async () => {}),
    createSubscriber: async () => ({ subscribe: () => {} }),
    disconnect: async () => {},
    getConfig: async () => null,
    setConfig: async () => {},
    ...overrides,
  };
}

/**
 * Builds a ReflexionEngine with a mock board already injected so no real Redis
 * connection is ever attempted.  The optional apiClients argument is passed
 * through to the constructor.
 */
function makeEngine(apiClients = {}) {
  const engine = new ReflexionEngine(apiClients);
  // Replace the board that was created in the constructor with a safe mock.
  engine.board = createMockBoard();
  // Stub out retrieveKnowledge so callLLM tests are fast and deterministic.
  // Individual tests that want to exercise RAG can restore this.
  engine.retrieveKnowledge = async () => null;
  return engine;
}

// ── 1. Constructor ────────────────────────────────────────────────────────────

describe('ReflexionEngine — constructor', () => {
  it('initialises dailyCost to 0', () => {
    const engine = makeEngine();
    assert.equal(engine.dailyCost, 0);
  });

  it('initialises totalCalls to 0', () => {
    const engine = makeEngine();
    assert.equal(engine.totalCalls, 0);
  });

  it('initialises modelUsage to empty object', () => {
    const engine = makeEngine();
    assert.deepEqual(engine.modelUsage, {});
  });

  it('uses DEFAULT_CONFIG values', () => {
    const engine = makeEngine();
    assert.equal(engine.config.maxCostPerDay, DEFAULT_CONFIG.maxCostPerDay);
    assert.equal(engine.config.costPerAttempt, DEFAULT_CONFIG.costPerAttempt);
  });
});

// ── 2. callLLM — cost limit guard ────────────────────────────────────────────

describe('ReflexionEngine — callLLM cost limit', () => {
  it('returns null when dailyCost has reached maxCostPerDay', async () => {
    const engine = makeEngine();
    engine.dailyCost = engine.config.maxCostPerDay; // already at limit

    const result = await engine.callLLM('test prompt');
    assert.equal(result, null);
  });

  it('does not increment totalCalls when cost limit is exceeded', async () => {
    const engine = makeEngine();
    engine.dailyCost = engine.config.maxCostPerDay;

    await engine.callLLM('test prompt');
    assert.equal(engine.totalCalls, 0);
  });
});

// ── 3. callLLM — primary model (google/gemini client) ────────────────────────

describe('ReflexionEngine — callLLM primary model', () => {
  it('calls the google client when the primary model starts with "gemini"', async () => {
    const googleCall = mock.fn(async () => 'gemini-response');
    const engine = makeEngine({ google: { call: googleCall } });

    // Ensure primary model is a gemini model (default is gemini-3.0-flash).
    engine.config.model = 'gemini-3.0-flash';

    const result = await engine.callLLM('my prompt');

    assert.equal(result, 'gemini-response');
    assert.equal(googleCall.mock.callCount(), 1);
  });

  it('passes the model name to the google client', async () => {
    const googleCall = mock.fn(async () => 'ok');
    const engine = makeEngine({ google: { call: googleCall } });
    engine.config.model = 'gemini-3.0-flash';

    await engine.callLLM('hello');

    const [modelArg] = googleCall.mock.calls[0].arguments;
    assert.equal(modelArg, 'gemini-3.0-flash');
  });
});

// ── 4. callLLM — fallback to secondary (anthropic) ───────────────────────────

describe('ReflexionEngine — callLLM secondary fallback', () => {
  it('falls back to anthropic when primary (gemini) fails', async () => {
    const googleCall = mock.fn(async () => { throw new Error('gemini unavailable'); });
    const anthropicCall = mock.fn(async () => 'anthropic-response');

    const engine = makeEngine({ google: { call: googleCall }, anthropic: { call: anthropicCall } });
    engine.config.model = 'gemini-3.0-flash';
    engine.config.escalationModel = 'claude-sonnet-4-6';

    const result = await engine.callLLM('hello');

    assert.equal(result, 'anthropic-response');
    assert.equal(googleCall.mock.callCount(), 1);
    assert.equal(anthropicCall.mock.callCount(), 1);
  });

  it('uses escalationModel (not ultraModel) for normal severity', async () => {
    const googleCall = mock.fn(async () => { throw new Error('fail'); });
    const anthropicCall = mock.fn(async () => 'ok');

    const engine = makeEngine({ google: { call: googleCall }, anthropic: { call: anthropicCall } });
    engine.config.model = 'gemini-3.0-flash';
    engine.config.escalationModel = 'claude-sonnet-4-6';
    engine.config.ultraModel = 'claude-opus-4-6';

    await engine.callLLM('prompt', 'normal');

    const [modelArg] = anthropicCall.mock.calls[0].arguments;
    assert.equal(modelArg, 'claude-sonnet-4-6');
  });

  it('uses ultraModel for critical severity as secondary', async () => {
    const googleCall = mock.fn(async () => { throw new Error('fail'); });
    const anthropicCall = mock.fn(async () => 'ok');

    const engine = makeEngine({ google: { call: googleCall }, anthropic: { call: anthropicCall } });
    engine.config.model = 'gemini-3.0-flash';
    engine.config.ultraModel = 'claude-opus-4-6';

    await engine.callLLM('prompt', 'critical');

    const [modelArg] = anthropicCall.mock.calls[0].arguments;
    assert.equal(modelArg, 'claude-opus-4-6');
  });
});

// ── 5. callLLM — local fallback when both primary and secondary fail ──────────

describe('ReflexionEngine — callLLM local fallback', () => {
  it('falls back to local model when primary and secondary both fail', async () => {
    const googleCall = mock.fn(async () => { throw new Error('gemini down'); });
    const anthropicCall = mock.fn(async () => { throw new Error('anthropic down'); });
    const localCall = mock.fn(async () => 'local-response');

    const engine = makeEngine({
      google: { call: googleCall },
      anthropic: { call: anthropicCall },
      local: { call: localCall },
    });
    engine.config.model = 'gemini-3.0-flash';
    engine.config.fallbackModel = 'local:qwen/qwen3.5-9b';

    const result = await engine.callLLM('hello');

    assert.equal(result, 'local-response');
    assert.equal(localCall.mock.callCount(), 1);
  });

  it('calls local with model name stripped of "local:" prefix', async () => {
    const googleCall = mock.fn(async () => { throw new Error('fail'); });
    const anthropicCall = mock.fn(async () => { throw new Error('fail'); });
    const localCall = mock.fn(async () => 'ok');

    const engine = makeEngine({
      google: { call: googleCall },
      anthropic: { call: anthropicCall },
      local: { call: localCall },
    });
    engine.config.model = 'gemini-3.0-flash';
    engine.config.fallbackModel = 'local:qwen/qwen3.5-9b';

    await engine.callLLM('hello');

    const [modelArg] = localCall.mock.calls[0].arguments;
    assert.equal(modelArg, 'qwen/qwen3.5-9b');
  });
});

// ── 6. callLLM — all models fail → returns null ───────────────────────────────

describe('ReflexionEngine — callLLM all models fail', () => {
  it('returns null when every model throws', async () => {
    const failing = mock.fn(async () => { throw new Error('down'); });

    const engine = makeEngine({
      google: { call: failing },
      anthropic: { call: failing },
      local: { call: failing },
    });
    engine.config.model = 'gemini-3.0-flash';
    engine.config.fallbackModel = 'local:qwen/qwen3.5-9b';

    const result = await engine.callLLM('test');

    assert.equal(result, null);
  });

  it('returns null when no API clients are provided and model has no client', async () => {
    const engine = makeEngine({}); // no clients at all
    engine.config.model = 'gemini-3.0-flash'; // requires google client
    engine.config.fallbackModel = 'local:qwen/qwen3.5-9b'; // requires local client

    const result = await engine.callLLM('test');
    assert.equal(result, null);
  });
});

// ── 7. callLLM — increments totalCalls and dailyCost ─────────────────────────

describe('ReflexionEngine — callLLM counters', () => {
  it('increments totalCalls by 1 per call', async () => {
    const googleCall = mock.fn(async () => 'ok');
    const engine = makeEngine({ google: { call: googleCall } });
    engine.config.model = 'gemini-3.0-flash';

    await engine.callLLM('a');
    assert.equal(engine.totalCalls, 1);

    await engine.callLLM('b');
    assert.equal(engine.totalCalls, 2);
  });

  it('increments dailyCost by costPerAttempt per call', async () => {
    const googleCall = mock.fn(async () => 'ok');
    const engine = makeEngine({ google: { call: googleCall } });
    engine.config.model = 'gemini-3.0-flash';

    await engine.callLLM('test');
    assert.equal(engine.dailyCost, engine.config.costPerAttempt);
  });
});

// ── 8. callLLM — skips RAG for 'light' severity ──────────────────────────────

describe('ReflexionEngine — callLLM skips RAG for light severity', () => {
  it('does not call retrieveKnowledge when severity is "light"', async () => {
    const anthropicCall = mock.fn(async () => 'lite-response');
    const engine = makeEngine({ anthropic: { call: anthropicCall } });

    // Override config so google client is not used (anthropic is the fallback path)
    engine.config.model = 'claude-sonnet-4-5'; // liteModel is reached directly
    engine.config.liteModel = 'claude-sonnet-4-5';

    let retrieveCalled = false;
    engine.retrieveKnowledge = async () => {
      retrieveCalled = true;
      return 'some-knowledge';
    };

    await engine.callLLM('prompt', 'light');

    assert.equal(retrieveCalled, false, 'retrieveKnowledge should not be called for light severity');
  });
});

// ── 9. callLLM — forceLocal for 'local' severity ─────────────────────────────

describe('ReflexionEngine — callLLM forceLocal for "local" severity', () => {
  it('goes straight to local model and skips google and anthropic', async () => {
    const googleCall = mock.fn(async () => 'should-not-be-called');
    const anthropicCall = mock.fn(async () => 'should-not-be-called');
    const localCall = mock.fn(async () => 'local-direct');

    const engine = makeEngine({
      google: { call: googleCall },
      anthropic: { call: anthropicCall },
      local: { call: localCall },
    });
    engine.config.model = 'gemini-3.0-flash';
    engine.config.fallbackModel = 'local:qwen/qwen3.5-9b';

    const result = await engine.callLLM('task', 'local');

    assert.equal(result, 'local-direct');
    assert.equal(googleCall.mock.callCount(), 0, 'google should not be called');
    assert.equal(anthropicCall.mock.callCount(), 0, 'anthropic should not be called');
    assert.equal(localCall.mock.callCount(), 1);
  });

  it('does not call retrieveKnowledge when severity is "local"', async () => {
    const localCall = mock.fn(async () => 'ok');
    const engine = makeEngine({ local: { call: localCall } });
    engine.config.fallbackModel = 'local:qwen/qwen3.5-9b';

    let retrieveCalled = false;
    engine.retrieveKnowledge = async () => {
      retrieveCalled = true;
      return 'knowledge';
    };

    await engine.callLLM('prompt', 'local');

    assert.equal(retrieveCalled, false);
  });
});

// ── 10. handleIntent — returns null when callLLM returns null ─────────────────

describe('ReflexionEngine — handleIntent null LLM response', () => {
  it('returns null when callLLM returns null', async () => {
    const engine = makeEngine();
    // All clients missing → callLLM will return null
    engine.config.model = 'gemini-3.0-flash';
    engine.config.fallbackModel = 'local:qwen/qwen3.5-9b';

    const result = await engine.handleIntent('search the web for cats');
    assert.equal(result, null);
  });
});

// ── 11. handleIntent — returns null when response has no JSON ─────────────────

describe('ReflexionEngine — handleIntent no JSON in response', () => {
  it('returns null when LLM response has no JSON object', async () => {
    const anthropicCall = mock.fn(async () => 'Sorry, I cannot help with that.');
    const engine = makeEngine({ anthropic: { call: anthropicCall } });
    engine.config.model = 'claude-sonnet-4-6'; // anthropic path directly

    const result = await engine.handleIntent('some input');
    assert.equal(result, null);
  });
});

// ── 12. handleIntent — RESEARCH intent ───────────────────────────────────────

describe('ReflexionEngine — handleIntent RESEARCH intent', () => {
  it('publishes crawler:start and returns research-started message', async () => {
    const responseJson = JSON.stringify({ intent: 'RESEARCH', payload: 'https://example.com' });
    const anthropicCall = mock.fn(async () => responseJson);

    const engine = makeEngine({ anthropic: { call: anthropicCall } });
    engine.config.model = 'claude-sonnet-4-6';

    const result = await engine.handleIntent('crawl example.com');

    assert.equal(result, 'Research started. I will update you once crawling is complete.');

    // Verify the blackboard publish was called
    const publishCalls = engine.board.publish.mock.calls;
    const crawlerCall = publishCalls.find(c => c.arguments[0] === 'crawler:start');
    assert.ok(crawlerCall, 'Should publish to crawler:start');
    assert.equal(crawlerCall.arguments[1].url, 'https://example.com');
  });
});

// ── 13. handleIntent — AUTOMATION intent ─────────────────────────────────────

describe('ReflexionEngine — handleIntent AUTOMATION intent', () => {
  it('publishes google:task and returns automation-queued message', async () => {
    const responseJson = JSON.stringify({ intent: 'AUTOMATION', payload: 'create spreadsheet' });
    const anthropicCall = mock.fn(async () => responseJson);

    const engine = makeEngine({ anthropic: { call: anthropicCall } });
    engine.config.model = 'claude-sonnet-4-6';

    const result = await engine.handleIntent('create a google sheet');

    assert.equal(result, 'Google Automation task queued.');

    const publishCalls = engine.board.publish.mock.calls;
    const googleCall = publishCalls.find(c => c.arguments[0] === 'google:task');
    assert.ok(googleCall, 'Should publish to google:task');
    assert.equal(googleCall.arguments[1].action, 'automate');
    assert.equal(googleCall.arguments[1].description, 'create spreadsheet');
  });
});

// ── 14. getStats ─────────────────────────────────────────────────────────────

describe('ReflexionEngine — getStats', () => {
  it('returns correct totalCalls after calls', async () => {
    const anthropicCall = mock.fn(async () => 'ok');
    const engine = makeEngine({ anthropic: { call: anthropicCall } });
    engine.config.model = 'claude-sonnet-4-6';

    await engine.callLLM('one');
    await engine.callLLM('two');

    const stats = engine.getStats();
    assert.equal(stats.totalCalls, 2);
  });

  it('returns correct dailyCost after calls', async () => {
    const anthropicCall = mock.fn(async () => 'ok');
    const engine = makeEngine({ anthropic: { call: anthropicCall } });
    engine.config.model = 'claude-sonnet-4-6';

    await engine.callLLM('a');

    const stats = engine.getStats();
    assert.equal(stats.dailyCost, engine.config.costPerAttempt);
  });

  it('returns correct modelUsage after calls', async () => {
    const anthropicCall = mock.fn(async () => 'ok');
    const engine = makeEngine({ anthropic: { call: anthropicCall } });
    engine.config.model = 'claude-sonnet-4-6';

    await engine.callLLM('test');

    const stats = engine.getStats();
    assert.equal(stats.modelUsage['claude-sonnet-4-6'], 1);
  });

  it('returns a copy of modelUsage (not a reference)', () => {
    const engine = makeEngine();
    engine.modelUsage = { 'gemini-3.0-flash': 3 };

    const stats = engine.getStats();
    stats.modelUsage['gemini-3.0-flash'] = 99; // mutate the returned copy

    assert.equal(engine.modelUsage['gemini-3.0-flash'], 3, 'original should be unchanged');
  });

  it('returns a copy of config (not a reference)', () => {
    const engine = makeEngine();
    const stats = engine.getStats();
    stats.config.maxCostPerDay = 0;

    assert.equal(engine.config.maxCostPerDay, DEFAULT_CONFIG.maxCostPerDay, 'original config should be unchanged');
  });
});

// ── 15. _injectKnowledge ─────────────────────────────────────────────────────

describe('ReflexionEngine — _injectKnowledge', () => {
  it('prepends knowledge base header before the prompt', () => {
    const engine = makeEngine();
    const knowledge = 'Redis is an in-memory data store.';
    const prompt = 'Explain how to use Redis.';

    const augmented = engine._injectKnowledge(prompt, knowledge);

    assert.ok(
      augmented.startsWith('[Knowledge Base: External context retrieved from Obsidian Vault]'),
      'Should start with knowledge base header'
    );
    assert.ok(augmented.includes(knowledge), 'Should include the knowledge content');
    assert.ok(augmented.includes(prompt), 'Should include the original prompt');
  });

  it('separates knowledge from prompt with [Task] marker', () => {
    const engine = makeEngine();
    const knowledge = 'Some facts.';
    const prompt = 'Do the thing.';

    const augmented = engine._injectKnowledge(prompt, knowledge);

    const taskIndex = augmented.indexOf('[Task]');
    const promptIndex = augmented.indexOf(prompt);

    assert.ok(taskIndex !== -1, 'Should contain [Task] marker');
    assert.ok(promptIndex > taskIndex, 'Prompt should appear after [Task] marker');
  });

  it('produces expected exact format', () => {
    const engine = makeEngine();
    const knowledge = 'fact';
    const prompt = 'do it';

    const result = engine._injectKnowledge(prompt, knowledge);
    const expected =
      '[Knowledge Base: External context retrieved from Obsidian Vault]\nfact\n\n[Task]\ndo it';

    assert.equal(result, expected);
  });
});
