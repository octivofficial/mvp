/**
 * LMStudioClient Tests — cached health, multi-URL failover, <think> stripping, retry
 * Usage: node --test --test-force-exit test/lm-studio-client.test.js
 */
const { describe, it, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const LM_CLIENT_PATH = require.resolve('../agent/lm-studio-client');
const TIMEOUTS_PATH = require.resolve('../config/timeouts');

function freshRequire() {
  delete require.cache[LM_CLIENT_PATH];
  delete require.cache[TIMEOUTS_PATH];
  return require('../agent/lm-studio-client');
}

// ── Constructor ─────────────────────────────────────────────────────

describe('LMStudioClient — Constructor', () => {
  let savedUrl, savedUrls, originalFetch;

  before(() => {
    savedUrl = process.env.LM_STUDIO_URL;
    savedUrls = process.env.LM_STUDIO_URLS;
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (savedUrl !== undefined) process.env.LM_STUDIO_URL = savedUrl;
    else delete process.env.LM_STUDIO_URL;
    if (savedUrls !== undefined) process.env.LM_STUDIO_URLS = savedUrls;
    else delete process.env.LM_STUDIO_URLS;
    delete require.cache[LM_CLIENT_PATH];
  });

  it('should use default URL when no env is set', () => {
    delete process.env.LM_STUDIO_URL;
    delete process.env.LM_STUDIO_URLS;
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    assert.deepStrictEqual(client.urls, ['http://localhost:1234']);
  });

  it('should use LM_STUDIO_URL env', () => {
    process.env.LM_STUDIO_URL = 'http://gpu-box:5678';
    delete process.env.LM_STUDIO_URLS;
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    assert.deepStrictEqual(client.urls, ['http://gpu-box:5678']);
    delete process.env.LM_STUDIO_URL;
  });

  it('should parse LM_STUDIO_URLS as comma-separated list', () => {
    process.env.LM_STUDIO_URLS = 'http://a:1234,http://b:5678';
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    assert.deepStrictEqual(client.urls, ['http://a:1234', 'http://b:5678']);
    delete process.env.LM_STUDIO_URLS;
  });

  it('should prefer constructor urls over env', () => {
    process.env.LM_STUDIO_URL = 'http://env:1234';
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient({ urls: ['http://opt:9999'] });
    assert.deepStrictEqual(client.urls, ['http://opt:9999']);
    delete process.env.LM_STUDIO_URL;
  });

  it('should start unhealthy with no active URL', () => {
    delete process.env.LM_STUDIO_URL;
    delete process.env.LM_STUDIO_URLS;
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    assert.equal(client._healthy, false);
    assert.equal(client._activeUrl, null);
  });
});

// ── cleanResponse (static) ──────────────────────────────────────────

describe('LMStudioClient — cleanResponse', () => {
  let LMStudioClient;

  before(() => {
    ({ LMStudioClient } = freshRequire());
  });

  after(() => {
    delete require.cache[LM_CLIENT_PATH];
  });

  it('should strip <think>...</think> tags', () => {
    assert.equal(
      LMStudioClient.cleanResponse('<think>reasoning here</think>Answer'),
      'Answer'
    );
  });

  it('should handle multiline think blocks', () => {
    const input = '<think>\nstep 1\nstep 2\n</think>\nFinal answer';
    assert.equal(LMStudioClient.cleanResponse(input), 'Final answer');
  });

  it('should pass through text without think tags', () => {
    assert.equal(LMStudioClient.cleanResponse('plain text'), 'plain text');
  });

  it('should handle empty string', () => {
    assert.equal(LMStudioClient.cleanResponse(''), '');
  });

  it('should handle null/undefined', () => {
    assert.equal(LMStudioClient.cleanResponse(null), '');
    assert.equal(LMStudioClient.cleanResponse(undefined), '');
  });

  it('should strip multiple think blocks', () => {
    const input = '<think>a</think>Hello<think>b</think> world';
    assert.equal(LMStudioClient.cleanResponse(input), 'Hello world');
  });
});

// ── checkHealth ─────────────────────────────────────────────────────

describe('LMStudioClient — checkHealth', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete require.cache[LM_CLIENT_PATH];
  });

  it('should set healthy=true on successful probe', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen' }] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    await client.checkHealth();
    assert.equal(client._healthy, true);
    assert.equal(client._activeUrl, 'http://localhost:1234');
  });

  it('should set healthy=false on network failure', async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    await client.checkHealth();
    assert.equal(client._healthy, false);
    assert.equal(client._activeUrl, null);
  });

  it('should set healthy=false on non-ok response', async () => {
    globalThis.fetch = mock.fn(async () => ({ ok: false, status: 500 }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    await client.checkHealth();
    assert.equal(client._healthy, false);
  });

  it('should try URLs in order and pick first healthy', async () => {
    globalThis.fetch = mock.fn(async (url) => {
      if (url.includes('//a:')) throw new Error('down');
      return { ok: true, json: async () => ({ data: [{ id: 'm' }] }) };
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient({ urls: ['http://a:1234', 'http://b:5678'] });
    await client.checkHealth();
    assert.equal(client._healthy, true);
    assert.equal(client._activeUrl, 'http://b:5678');
  });

  it('should update health timestamp', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'x' }] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    const before = Date.now();
    await client.checkHealth();
    assert.ok(client._lastHealthCheck >= before);
  });

  it('should log available models', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen3.5' }, { id: 'llama3' }] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    await client.checkHealth();
    assert.deepStrictEqual(client._models, ['qwen3.5', 'llama3']);
  });

  it('should handle missing data field gracefully', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    await client.checkHealth();
    assert.equal(client._healthy, true);
    assert.deepStrictEqual(client._models, []);
  });
});

// ── call — success ──────────────────────────────────────────────────

describe('LMStudioClient — call success', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete require.cache[LM_CLIENT_PATH];
  });

  it('should return cleaned response on success', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '<think>ok</think>Hello' } }],
      }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    const result = await client.call('qwen', 'hi');
    assert.equal(result, 'Hello');
  });

  it('should pass correct params to inference', async () => {
    let capturedUrl, capturedBody;
    globalThis.fetch = mock.fn(async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    await client.call('qwen3', 'test prompt');
    assert.equal(capturedUrl, 'http://localhost:1234/v1/chat/completions');
    assert.equal(capturedBody.model, 'qwen3');
    assert.equal(capturedBody.messages[0].content, 'test prompt');
    assert.equal(capturedBody.temperature, 0.7);
    assert.equal(capturedBody.max_tokens, 1024);
  });

  it('should set Content-Type header', async () => {
    let capturedHeaders;
    globalThis.fetch = mock.fn(async (url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    await client.call('m', 'p');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  });

  it('should return empty string when choices is empty', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    const result = await client.call('m', 'p');
    assert.equal(result, '');
  });

  it('should return empty string when choices is undefined', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    const result = await client.call('m', 'p');
    assert.equal(result, '');
  });
});

// ── call — failure/retry ────────────────────────────────────────────

describe('LMStudioClient — call failure/retry', () => {
  let originalFetch, savedRetryDelay;

  before(() => {
    originalFetch = globalThis.fetch;
    savedRetryDelay = process.env.LM_STUDIO_RETRY_DELAY_MS;
    process.env.LM_STUDIO_RETRY_DELAY_MS = '1'; // fast retry for tests
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (savedRetryDelay !== undefined) process.env.LM_STUDIO_RETRY_DELAY_MS = savedRetryDelay;
    else delete process.env.LM_STUDIO_RETRY_DELAY_MS;
  });

  afterEach(() => {
    delete require.cache[LM_CLIENT_PATH];
    delete require.cache[TIMEOUTS_PATH];
  });

  it('should fail fast when not healthy and no URLs work', async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error('down'); });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    // not healthy, no active URL
    await assert.rejects(
      () => client.call('m', 'p'),
      (err) => err.message.includes('LM Studio not reachable')
    );
  });

  it('should retry once on inference failure then succeed', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('transient');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'recovered' } }] }),
      };
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    const result = await client.call('m', 'p');
    assert.equal(result, 'recovered');
    assert.equal(callCount, 2);
  });

  it('should try next URL after active URL exhausts retries', async () => {
    let fetchCalls = [];
    globalThis.fetch = mock.fn(async (url) => {
      fetchCalls.push(url);
      if (url.includes('//a:')) throw new Error('down');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'from-b' } }] }),
      };
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient({ urls: ['http://a:1234', 'http://b:5678'] });
    client._healthy = true;
    client._activeUrl = 'http://a:1234';
    const result = await client.call('m', 'p');
    assert.equal(result, 'from-b');
    // Should have tried a twice (initial + retry), then b once
    const aCalls = fetchCalls.filter(u => u.includes('//a:'));
    const bCalls = fetchCalls.filter(u => u.includes('//b:'));
    assert.equal(aCalls.length, 2);
    assert.equal(bCalls.length, 1);
  });

  it('should throw after exhausting all URLs', async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error('all down'); });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient({ urls: ['http://a:1', 'http://b:2'] });
    client._healthy = true;
    client._activeUrl = 'http://a:1';
    await assert.rejects(
      () => client.call('m', 'p'),
      (err) => err.message.includes('all down')
    );
  });

  it('should handle non-ok inference response', async () => {
    let callCount = 0;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      return { ok: false, status: 500, text: async () => 'Server Error' };
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    await assert.rejects(
      () => client.call('m', 'p'),
      (err) => err.message.includes('500')
    );
    // Should have retried once
    assert.equal(callCount, 2);
  });

  it('should attempt health check when not healthy before failing', async () => {
    let healthChecked = false;
    globalThis.fetch = mock.fn(async (url) => {
      if (url.includes('/v1/models')) {
        healthChecked = true;
        throw new Error('still down');
      }
      throw new Error('down');
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    // Not healthy — should try checkHealth first
    await assert.rejects(
      () => client.call('m', 'p'),
      (err) => err.message.includes('not reachable')
    );
    assert.ok(healthChecked, 'should have attempted health check');
  });
});

// ── Health monitor ──────────────────────────────────────────────────

describe('LMStudioClient — Health monitor', () => {
  let originalFetch, savedInterval;

  before(() => {
    originalFetch = globalThis.fetch;
    savedInterval = process.env.LM_STUDIO_HEALTH_INTERVAL_MS;
    process.env.LM_STUDIO_HEALTH_INTERVAL_MS = '10'; // fast for tests
  });

  after(() => {
    globalThis.fetch = originalFetch;
    if (savedInterval !== undefined) process.env.LM_STUDIO_HEALTH_INTERVAL_MS = savedInterval;
    else delete process.env.LM_STUDIO_HEALTH_INTERVAL_MS;
  });

  afterEach(() => {
    delete require.cache[LM_CLIENT_PATH];
    delete require.cache[TIMEOUTS_PATH];
  });

  it('should start and stop interval', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client.startHealthMonitor();
    assert.ok(client._healthInterval !== null);
    await new Promise(r => setTimeout(r, 30));
    client.stopHealthMonitor();
    assert.equal(client._healthInterval, null);
  });

  it('should poll health during interval', async () => {
    let healthCalls = 0;
    globalThis.fetch = mock.fn(async () => {
      healthCalls++;
      return { ok: true, json: async () => ({ data: [] }) };
    });
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client.startHealthMonitor();
    await new Promise(r => setTimeout(r, 35));
    client.stopHealthMonitor();
    assert.ok(healthCalls >= 2, `expected >=2 health calls, got ${healthCalls}`);
  });

  it('should be safe to stop when not started', () => {
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    assert.doesNotThrow(() => client.stopHealthMonitor());
  });

  it('should be idempotent on multiple starts', () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client.startHealthMonitor();
    const first = client._healthInterval;
    client.startHealthMonitor();
    assert.equal(client._healthInterval, first, 'should not create duplicate interval');
    client.stopHealthMonitor();
  });
});

// ── Blackboard integration ──────────────────────────────────────────

describe('LMStudioClient — Blackboard integration', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete require.cache[LM_CLIENT_PATH];
  });

  it('should publish health status to blackboard', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen' }] }),
    }));
    const mockBoard = { publish: mock.fn(async () => {}) };
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient({ board: mockBoard });
    await client.checkHealth();
    assert.equal(mockBoard.publish.mock.callCount(), 1);
    const args = mockBoard.publish.mock.calls[0].arguments;
    assert.equal(args[0], 'infra:lm-studio:health');
    const payload = args[1];
    assert.equal(typeof payload, 'object');
    assert.equal(payload.healthy, true);
    assert.equal(payload.author, 'lm-studio-client');
  });

  it('should publish unhealthy status', async () => {
    globalThis.fetch = mock.fn(async () => { throw new Error('down'); });
    const mockBoard = { publish: mock.fn(async () => {}) };
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient({ board: mockBoard });
    await client.checkHealth();
    const payload = mockBoard.publish.mock.calls[0].arguments[1];
    assert.equal(payload.healthy, false);
    assert.equal(payload.author, 'lm-studio-client');
  });

  it('should work without board (noop)', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    // Should not throw
    await assert.doesNotReject(() => client.checkHealth());
  });

  it('should not throw if board.publish rejects', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    const mockBoard = { publish: mock.fn(async () => { throw new Error('redis down'); }) };
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient({ board: mockBoard });
    await assert.doesNotReject(() => client.checkHealth());
  });
});

// ── Model verification ──────────────────────────────────────────────

describe('LMStudioClient — Model verification', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete require.cache[LM_CLIENT_PATH];
  });

  it('should track available models after health check', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen3.5-9B' }, { id: 'llama3' }] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    await client.checkHealth();
    assert.deepStrictEqual(client._models, ['qwen3.5-9B', 'llama3']);
  });

  it('should still allow call when requested model not in list', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'works' } }] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    client._healthy = true;
    client._activeUrl = 'http://localhost:1234';
    client._models = ['qwen3.5'];
    const result = await client.call('unknown-model', 'p');
    assert.equal(result, 'works');
  });

  it('should have empty models when health returns no data', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    const { LMStudioClient } = freshRequire();
    const client = new LMStudioClient();
    await client.checkHealth();
    assert.deepStrictEqual(client._models, []);
  });
});
