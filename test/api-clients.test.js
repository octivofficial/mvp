/**
 * API Clients Tests — coverage for LM Studio, Anthropic call, Groq paths
 * Usage: node --test --test-force-exit test/api-clients.test.js
 */
const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const API_CLIENTS_PATH = require.resolve('../agent/api-clients');

function freshRequire() {
  delete require.cache[API_CLIENTS_PATH];
  return require('../agent/api-clients');
}

// ── LM Studio Disabled ──────────────────────────────────────────────

describe('ApiClients — LM Studio disabled', () => {
  let savedEnabled;

  before(() => {
    savedEnabled = process.env.LM_STUDIO_ENABLED;
  });

  after(() => {
    if (savedEnabled !== undefined) process.env.LM_STUDIO_ENABLED = savedEnabled;
    else delete process.env.LM_STUDIO_ENABLED;
    delete require.cache[API_CLIENTS_PATH];
  });

  it('should skip local client when LM_STUDIO_ENABLED=false', () => {
    process.env.LM_STUDIO_ENABLED = 'false';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;

    const { createApiClients } = freshRequire();
    const clients = createApiClients();

    assert.equal(clients.local, undefined, 'local client should be skipped');
  });
});

// ── LM Studio Client .call() ────────────────────────────────────────

describe('ApiClients — LM Studio client.call()', () => {
  let savedEnabled, savedKey, savedGroq, originalFetch;

  before(() => {
    savedEnabled = process.env.LM_STUDIO_ENABLED;
    savedKey = process.env.ANTHROPIC_API_KEY;
    savedGroq = process.env.GROQ_API_KEY;
    originalFetch = globalThis.fetch;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.LM_STUDIO_ENABLED;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (savedEnabled !== undefined) process.env.LM_STUDIO_ENABLED = savedEnabled;
    else delete process.env.LM_STUDIO_ENABLED;
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (savedGroq) process.env.GROQ_API_KEY = savedGroq;
    else delete process.env.GROQ_API_KEY;
    delete require.cache[API_CLIENTS_PATH];
  });

  it('should throw when LM Studio health check fails', async () => {
    globalThis.fetch = mock.fn(async () => null);

    const { createApiClients } = freshRequire();
    const clients = createApiClients();

    assert.ok(clients.local, 'local client should exist');
    await assert.rejects(
      () => clients.local.call('test-model', 'hello'),
      { message: 'LM Studio not reachable' }
    );
  });

  it('should throw on non-ok response from LM Studio', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: true }; // health check passes
      return { ok: false, status: 500, text: async () => 'Internal Error' }; // API call fails
    });

    const { createApiClients } = freshRequire();
    const clients = createApiClients();

    await assert.rejects(
      () => clients.local.call('test-model', 'hello'),
      (err) => err.message.includes('500')
    );
  });

  it('should return content on successful LM Studio call', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: true }; // health check
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'LM Studio response' } }],
        }),
      };
    });

    const { createApiClients } = freshRequire();
    const clients = createApiClients();

    const result = await clients.local.call('test-model', 'hello');
    assert.equal(result, 'LM Studio response');
  });

  it('should return empty string when response has no content', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: true };
      return { ok: true, json: async () => ({ choices: [] }) };
    });

    const { createApiClients } = freshRequire();
    const clients = createApiClients();

    const result = await clients.local.call('test-model', 'hello');
    assert.equal(result, '');
  });
});

// ── Anthropic client.call() ─────────────────────────────────────────

describe('ApiClients — Anthropic client.call()', () => {
  let savedKey, savedGroq, savedEnabled;

  before(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    savedGroq = process.env.GROQ_API_KEY;
    savedEnabled = process.env.LM_STUDIO_ENABLED;
  });

  after(() => {
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (savedGroq) process.env.GROQ_API_KEY = savedGroq;
    else delete process.env.GROQ_API_KEY;
    if (savedEnabled !== undefined) process.env.LM_STUDIO_ENABLED = savedEnabled;
    else delete process.env.LM_STUDIO_ENABLED;
    delete require.cache[API_CLIENTS_PATH];
  });

  it('should call Anthropic SDK and return text', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
    process.env.LM_STUDIO_ENABLED = 'false';
    delete process.env.GROQ_API_KEY;

    // Mock the Anthropic SDK at module level
    const mockCreate = mock.fn(async () => ({
      content: [{ text: 'Claude response' }],
    }));

    // Inject mock into require cache
    const sdkPath = require.resolve('@anthropic-ai/sdk');
    const origModule = require.cache[sdkPath];
    require.cache[sdkPath] = {
      id: sdkPath,
      exports: class MockAnthropic {
        constructor() { this.messages = { create: mockCreate }; }
      },
    };

    try {
      const { createApiClients } = freshRequire();
      const clients = createApiClients();

      assert.ok(clients.anthropic, 'anthropic client should exist');
      const result = await clients.anthropic.call('haiku', 'test prompt');
      assert.equal(result, 'Claude response');
      assert.equal(mockCreate.mock.callCount(), 1);

      const args = mockCreate.mock.calls[0].arguments[0];
      assert.equal(args.model, 'haiku');
      assert.equal(args.messages[0].content, 'test prompt');
    } finally {
      if (origModule) require.cache[sdkPath] = origModule;
      else delete require.cache[sdkPath];
    }
  });

  it('should return empty string when Anthropic response has no text', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
    process.env.LM_STUDIO_ENABLED = 'false';
    delete process.env.GROQ_API_KEY;

    const sdkPath = require.resolve('@anthropic-ai/sdk');
    const origModule = require.cache[sdkPath];
    require.cache[sdkPath] = {
      id: sdkPath,
      exports: class MockAnthropic {
        constructor() {
          this.messages = { create: mock.fn(async () => ({ content: [] })) };
        }
      },
    };

    try {
      const { createApiClients } = freshRequire();
      const clients = createApiClients();
      const result = await clients.anthropic.call('haiku', 'test');
      assert.equal(result, '');
    } finally {
      if (origModule) require.cache[sdkPath] = origModule;
      else delete require.cache[sdkPath];
    }
  });
});

// ── Groq client ─────────────────────────────────────────────────────

describe('ApiClients — Groq client', () => {
  let savedKey, savedGroq, savedEnabled;

  before(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    savedGroq = process.env.GROQ_API_KEY;
    savedEnabled = process.env.LM_STUDIO_ENABLED;
  });

  after(() => {
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (savedGroq) process.env.GROQ_API_KEY = savedGroq;
    else delete process.env.GROQ_API_KEY;
    if (savedEnabled !== undefined) process.env.LM_STUDIO_ENABLED = savedEnabled;
    else delete process.env.LM_STUDIO_ENABLED;
    delete require.cache[API_CLIENTS_PATH];
  });

  it('should create Groq client when GROQ_API_KEY is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GROQ_API_KEY = 'gsk_test_key';
    process.env.LM_STUDIO_ENABLED = 'false';

    // groq-sdk is optional, mock it
    const groqSdkPath = require.resolve('groq-sdk');
    const origModule = require.cache[groqSdkPath];
    require.cache[groqSdkPath] = {
      id: groqSdkPath,
      exports: class MockGroq {
        constructor() {
          this.chat = {
            completions: {
              create: mock.fn(async () => ({
                choices: [{ message: { content: 'Groq response' } }],
              })),
            },
          };
        }
      },
    };

    try {
      const { createApiClients } = freshRequire();
      const clients = createApiClients();
      assert.ok(clients.groq, 'Groq client should exist');
      assert.equal(typeof clients.groq.call, 'function');
    } finally {
      if (origModule) require.cache[groqSdkPath] = origModule;
      else delete require.cache[groqSdkPath];
    }
  });

  it('should call Groq SDK and return content', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GROQ_API_KEY = 'gsk_test_key';
    process.env.LM_STUDIO_ENABLED = 'false';

    const mockCreate = mock.fn(async () => ({
      choices: [{ message: { content: 'Groq says hi' } }],
    }));

    const groqSdkPath = require.resolve('groq-sdk');
    const origModule = require.cache[groqSdkPath];
    require.cache[groqSdkPath] = {
      id: groqSdkPath,
      exports: class MockGroq {
        constructor() { this.chat = { completions: { create: mockCreate } }; }
      },
    };

    try {
      const { createApiClients } = freshRequire();
      const clients = createApiClients();
      const result = await clients.groq.call('llama3', 'test');
      assert.equal(result, 'Groq says hi');
    } finally {
      if (origModule) require.cache[groqSdkPath] = origModule;
      else delete require.cache[groqSdkPath];
    }
  });
});
