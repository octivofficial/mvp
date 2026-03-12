/**
 * NotebookLMMCP Tests — TDD Red-Green-Refactor (Phase 6)
 * Requirements (Requirement 7):
 *   - constructor stores port, notebookId, server=null
 *   - start() creates HTTP server, returns {port, status:'running'}
 *   - start() returns {port, status:'already_running'} if called again
 *   - stop() closes server, returns {status:'stopped'}
 *   - stop() returns {status:'not_running'} if not started
 *   - searchDocs() calls apiClient.searchDocs(query, limit), returns results
 *   - searchDocs() returns [] on error
 *   - syncProgress() calls apiClient.syncProgress(acData), returns {success:true}
 *   - syncProgress() returns {success:false, error:msg} on throw
 *   - getStatus() returns {running, port, notebookId}
 *
 * Usage: node --test test/notebooklm-mcp.test.js
 */
'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { NotebookLMMCP } = require('../agent/notebooklm-mcp');

// ── Mock helpers ────────────────────────────────────────────────

/**
 * Build a fake http module so no real TCP port is needed.
 * listen(port, cb) calls cb() synchronously.
 * close(cb) calls cb() synchronously.
 */
function makeMockHttpModule() {
  const makeServer = () => {
    const server = {
      listening: false,
      listen: mock.fn(function (port, cb) {
        this.listening = true;
        if (cb) cb();
      }),
      close: mock.fn(function (cb) {
        this.listening = false;
        if (cb) cb();
      }),
    };
    return server;
  };

  const httpModule = {
    _lastServer: null,
    createServer: mock.fn(function () {
      const s = makeServer();
      httpModule._lastServer = s;
      return s;
    }),
  };

  return httpModule;
}

/**
 * Build a mock apiClient with controllable search / sync behaviour.
 * @param {Function} [searchImpl] - override for searchDocs
 * @param {Function} [syncImpl]   - override for syncProgress
 */
function makeApiClient(searchImpl, syncImpl) {
  return {
    searchDocs: mock.fn(searchImpl || (async () => [])),
    syncProgress: mock.fn(syncImpl || (async () => ({ success: true }))),
  };
}

// ── constructor ─────────────────────────────────────────────────

describe('NotebookLMMCP — constructor', () => {
  it('should store default port 3100', () => {
    const mcp = new NotebookLMMCP({
      notebookId: 'nb-001',
      apiClient: makeApiClient(),
      httpModule: makeMockHttpModule(),
    });
    assert.equal(mcp.port, 3100, 'default port should be 3100');
  });

  it('should store a custom port when provided', () => {
    const mcp = new NotebookLMMCP({
      port: 4200,
      notebookId: 'nb-002',
      apiClient: makeApiClient(),
      httpModule: makeMockHttpModule(),
    });
    assert.equal(mcp.port, 4200, 'custom port should be stored');
  });

  it('should store notebookId', () => {
    const mcp = new NotebookLMMCP({
      notebookId: 'test-notebook-42',
      apiClient: makeApiClient(),
      httpModule: makeMockHttpModule(),
    });
    assert.equal(mcp.notebookId, 'test-notebook-42');
  });

  it('should initialize server to null', () => {
    const mcp = new NotebookLMMCP({
      notebookId: 'nb-003',
      apiClient: makeApiClient(),
      httpModule: makeMockHttpModule(),
    });
    assert.equal(mcp.server, null, 'server should be null before start');
  });

  it('should store the injected apiClient', () => {
    const client = makeApiClient();
    const mcp = new NotebookLMMCP({
      notebookId: 'nb-004',
      apiClient: client,
      httpModule: makeMockHttpModule(),
    });
    assert.strictEqual(mcp.apiClient, client);
  });
});

// ── start() ─────────────────────────────────────────────────────

describe('NotebookLMMCP — start()', () => {
  let mcp, httpModule;

  beforeEach(() => {
    httpModule = makeMockHttpModule();
    mcp = new NotebookLMMCP({
      port: 3100,
      notebookId: 'nb-start',
      apiClient: makeApiClient(),
      httpModule,
    });
  });

  afterEach(async () => {
    // clean up in case test left server running
    if (mcp.server) await mcp.stop();
  });

  it('should return {port: 3100, status: "running"} on first call', async () => {
    const result = await mcp.start();
    assert.equal(result.port, 3100);
    assert.equal(result.status, 'running');
  });

  it('should call httpModule.createServer() once', async () => {
    await mcp.start();
    assert.equal(httpModule.createServer.mock.calls.length, 1, 'createServer called once');
  });

  it('should call server.listen(port, cb) with the configured port', async () => {
    await mcp.start();
    const server = httpModule._lastServer;
    assert.equal(server.listen.mock.calls.length, 1, 'listen called once');
    const [passedPort] = server.listen.mock.calls[0].arguments;
    assert.equal(passedPort, 3100, 'listen should be called with port 3100');
  });

  it('should set this.server after start()', async () => {
    assert.equal(mcp.server, null, 'server is null before start');
    await mcp.start();
    assert.notEqual(mcp.server, null, 'server should be set after start');
  });

  it('should return {port, status: "already_running"} when called a second time', async () => {
    await mcp.start();
    const second = await mcp.start();
    assert.equal(second.port, 3100);
    assert.equal(second.status, 'already_running');
  });

  it('should NOT call createServer() again on second start() call', async () => {
    await mcp.start();
    await mcp.start();
    assert.equal(
      httpModule.createServer.mock.calls.length,
      1,
      'createServer should not be called again'
    );
  });
});

// ── stop() ──────────────────────────────────────────────────────

describe('NotebookLMMCP — stop()', () => {
  let mcp, httpModule;

  beforeEach(() => {
    httpModule = makeMockHttpModule();
    mcp = new NotebookLMMCP({
      port: 3100,
      notebookId: 'nb-stop',
      apiClient: makeApiClient(),
      httpModule,
    });
  });

  it('should return {status: "not_running"} when server was never started', async () => {
    const result = await mcp.stop();
    assert.equal(result.status, 'not_running');
  });

  it('should return {status: "stopped"} after a successful stop', async () => {
    await mcp.start();
    const result = await mcp.stop();
    assert.equal(result.status, 'stopped');
  });

  it('should call server.close() when stopping', async () => {
    await mcp.start();
    const server = mcp.server;
    await mcp.stop();
    assert.equal(server.close.mock.calls.length, 1, 'server.close should be called once');
  });

  it('should set this.server to null after stop()', async () => {
    await mcp.start();
    await mcp.stop();
    assert.equal(mcp.server, null, 'server should be null after stop');
  });

  it('should return {status: "not_running"} on second stop() call', async () => {
    await mcp.start();
    await mcp.stop();
    const second = await mcp.stop();
    assert.equal(second.status, 'not_running');
  });
});

// ── searchDocs() ────────────────────────────────────────────────

describe('NotebookLMMCP — searchDocs()', () => {
  let mcp, apiClient;

  beforeEach(() => {
    apiClient = makeApiClient();
    mcp = new NotebookLMMCP({
      notebookId: 'nb-search',
      apiClient,
      httpModule: makeMockHttpModule(),
    });
  });

  it('should call apiClient.searchDocs with the provided query and limit', async () => {
    apiClient.searchDocs = mock.fn(async () => []);
    await mcp.searchDocs('minecraft survival', 3);
    assert.equal(apiClient.searchDocs.mock.calls.length, 1);
    const [query, limit] = apiClient.searchDocs.mock.calls[0].arguments;
    assert.equal(query, 'minecraft survival');
    assert.equal(limit, 3);
  });

  it('should use default limit=5 when no limit is passed', async () => {
    apiClient.searchDocs = mock.fn(async () => []);
    await mcp.searchDocs('wood collection');
    const [, limit] = apiClient.searchDocs.mock.calls[0].arguments;
    assert.equal(limit, 5, 'default limit should be 5');
  });

  it('should return the results array from apiClient', async () => {
    const fakeResults = [
      { title: 'Wood Log Guide', content: 'Chop oak trees', relevance: 0.9 },
      { title: 'Crafting Basics', content: 'Use a crafting table', relevance: 0.7 },
    ];
    apiClient.searchDocs = mock.fn(async () => fakeResults);
    const results = await mcp.searchDocs('wood');
    assert.deepEqual(results, fakeResults);
  });

  it('should return [] when apiClient.searchDocs throws', async () => {
    apiClient.searchDocs = mock.fn(async () => {
      throw new Error('API timeout');
    });
    const results = await mcp.searchDocs('some query');
    assert.deepEqual(results, [], 'should return empty array on error');
  });

  it('should return [] when apiClient.searchDocs returns null', async () => {
    apiClient.searchDocs = mock.fn(async () => null);
    const results = await mcp.searchDocs('null test');
    assert.deepEqual(results, [], 'should normalise null to empty array');
  });

  it('should return top limit results when more results are returned', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      content: `Content ${i}`,
      relevance: (10 - i) / 10,
    }));
    apiClient.searchDocs = mock.fn(async () => manyResults);
    const results = await mcp.searchDocs('lots', 3);
    assert.equal(results.length, 3, 'should return only top 3 results');
  });
});

// ── syncProgress() ──────────────────────────────────────────────

describe('NotebookLMMCP — syncProgress()', () => {
  let mcp, apiClient;

  beforeEach(() => {
    apiClient = makeApiClient();
    mcp = new NotebookLMMCP({
      notebookId: 'nb-sync',
      apiClient,
      httpModule: makeMockHttpModule(),
    });
  });

  it('should call apiClient.syncProgress with the provided acData', async () => {
    apiClient.syncProgress = mock.fn(async () => ({ success: true }));
    const acData = { ac1: true, ac2: false };
    await mcp.syncProgress(acData);
    assert.equal(apiClient.syncProgress.mock.calls.length, 1);
    const [passedData] = apiClient.syncProgress.mock.calls[0].arguments;
    assert.deepEqual(passedData, acData);
  });

  it('should return {success: true} when apiClient.syncProgress succeeds', async () => {
    apiClient.syncProgress = mock.fn(async () => ({ success: true }));
    const result = await mcp.syncProgress({ ac1: true });
    assert.equal(result.success, true);
  });

  it('should return {success: false, error: msg} when apiClient.syncProgress throws', async () => {
    apiClient.syncProgress = mock.fn(async () => {
      throw new Error('Sync failed');
    });
    const result = await mcp.syncProgress({ ac1: true });
    assert.equal(result.success, false, 'success should be false on throw');
    assert.ok(typeof result.error === 'string', 'error should be a string');
    assert.ok(result.error.length > 0, 'error message should not be empty');
  });

  it('should include the original error message in result.error', async () => {
    const errorMessage = 'NotebookLM API rate limit exceeded';
    apiClient.syncProgress = mock.fn(async () => {
      throw new Error(errorMessage);
    });
    const result = await mcp.syncProgress({});
    assert.ok(
      result.error.includes(errorMessage),
      `error should include "${errorMessage}", got: "${result.error}"`
    );
  });

  it('should pass arbitrary acData shapes through to apiClient', async () => {
    apiClient.syncProgress = mock.fn(async () => ({ success: true }));
    const complexData = {
      ac1: { status: 'done', logs: 16 },
      ac2: { status: 'in_progress', blocks: 14 },
      timestamp: Date.now(),
    };
    await mcp.syncProgress(complexData);
    const [passedData] = apiClient.syncProgress.mock.calls[0].arguments;
    assert.deepEqual(passedData, complexData);
  });
});

// ── getStatus() ─────────────────────────────────────────────────

describe('NotebookLMMCP — getStatus()', () => {
  let mcp, httpModule;

  beforeEach(() => {
    httpModule = makeMockHttpModule();
    mcp = new NotebookLMMCP({
      port: 3100,
      notebookId: 'nb-status-test',
      apiClient: makeApiClient(),
      httpModule,
    });
  });

  afterEach(async () => {
    if (mcp.server) await mcp.stop();
  });

  it('should return {running: false} before start()', () => {
    const status = mcp.getStatus();
    assert.equal(status.running, false);
  });

  it('should return {running: true} after start()', async () => {
    await mcp.start();
    const status = mcp.getStatus();
    assert.equal(status.running, true);
  });

  it('should return the configured port in getStatus()', () => {
    const status = mcp.getStatus();
    assert.equal(status.port, 3100);
  });

  it('should return the configured notebookId in getStatus()', () => {
    const status = mcp.getStatus();
    assert.equal(status.notebookId, 'nb-status-test');
  });

  it('should return {running: false} after stop()', async () => {
    await mcp.start();
    await mcp.stop();
    const status = mcp.getStatus();
    assert.equal(status.running, false);
  });

  it('should return all three fields regardless of running state', () => {
    const status = mcp.getStatus();
    assert.ok('running' in status, 'running field should exist');
    assert.ok('port' in status, 'port field should exist');
    assert.ok('notebookId' in status, 'notebookId field should exist');
  });
});
