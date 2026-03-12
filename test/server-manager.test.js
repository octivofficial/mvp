/**
 * ServerManager Tests — Phase 8
 * TDD: Tests written FIRST, before implementation.
 * Usage: node --test test/server-manager.test.js
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { ServerManager } = require('../agent/server-manager');

// ── Mock Helpers ────────────────────────────────────────────────────

const makeBoard = () => ({
  setConfig: mock.fn(async () => {}),
  publish: mock.fn(async () => {}),
});

const makeServers = () => [
  { id: 'server-1', host: 'localhost', port: 25565, priority: 1, maxAgents: 5 },
  { id: 'server-2', host: 'mc2.local', port: 25565, priority: 2, maxAgents: 10 },
];

// ── Constructor ──────────────────────────────────────────────────────

describe('ServerManager — constructor', () => {
  it('initializes with empty servers when none provided', () => {
    const board = makeBoard();
    const sm = new ServerManager({ board });
    assert.deepEqual(sm.servers, [], 'servers should default to empty array');
  });

  it('initializes with provided servers array', () => {
    const board = makeBoard();
    const servers = makeServers();
    const sm = new ServerManager({ board, servers });
    assert.equal(sm.servers.length, 2, 'should load 2 servers from constructor');
  });

  it('initializes with empty statusMap', () => {
    const board = makeBoard();
    const sm = new ServerManager({ board });
    assert.deepEqual(sm.statusMap, {}, 'statusMap should default to empty object');
  });

  it('stores the board reference', () => {
    const board = makeBoard();
    const sm = new ServerManager({ board });
    assert.equal(sm.board, board, 'board reference should be stored');
  });
});

// ── loadServers() ────────────────────────────────────────────────────

describe('ServerManager — loadServers()', () => {
  let sm;
  let board;

  beforeEach(() => {
    board = makeBoard();
    sm = new ServerManager({ board });
  });

  it('loads server configs and returns count', () => {
    const count = sm.loadServers(makeServers());
    assert.equal(count, 2, 'should return count of servers loaded');
  });

  it('stores servers in this.servers', () => {
    const servers = makeServers();
    sm.loadServers(servers);
    assert.equal(sm.servers.length, 2, 'should store 2 servers');
    assert.equal(sm.servers[0].id, 'server-1', 'first server id should match');
  });

  it('replaces existing servers list', () => {
    sm.loadServers(makeServers());
    const newServers = [{ id: 'server-3', host: 'mc3.local', port: 25565, priority: 3, maxAgents: 3 }];
    const count = sm.loadServers(newServers);
    assert.equal(count, 1, 'should return count of new servers');
    assert.equal(sm.servers.length, 1, 'should replace old servers with new list');
    assert.equal(sm.servers[0].id, 'server-3', 'should have the new server');
  });

  it('returns 0 when loading empty array', () => {
    const count = sm.loadServers([]);
    assert.equal(count, 0, 'should return 0 for empty array');
    assert.deepEqual(sm.servers, [], 'servers should be empty array');
  });

  it('loads a single server correctly', () => {
    const single = [{ id: 'solo', host: 'solo.local', port: 25565, priority: 5, maxAgents: 2 }];
    const count = sm.loadServers(single);
    assert.equal(count, 1, 'should return 1 for single server');
    assert.equal(sm.servers[0].id, 'solo', 'single server id should match');
  });
});

// ── getAvailableServer() ─────────────────────────────────────────────

describe('ServerManager — getAvailableServer()', () => {
  let sm;
  let board;

  beforeEach(() => {
    board = makeBoard();
    sm = new ServerManager({ board });
  });

  it('returns null when no servers loaded', () => {
    const result = sm.getAvailableServer();
    assert.equal(result, null, 'should return null when no servers');
  });

  it('returns first server by priority (lowest number = highest priority)', () => {
    sm.loadServers([
      { id: 'server-low', host: 'low.local', port: 25565, priority: 5, maxAgents: 5 },
      { id: 'server-high', host: 'high.local', port: 25565, priority: 1, maxAgents: 5 },
    ]);
    const result = sm.getAvailableServer();
    assert.equal(result.id, 'server-high', 'should return server with lowest priority number');
  });

  it('skips offline servers', () => {
    sm.loadServers(makeServers());
    sm.statusMap['server-1'] = 'offline';
    const result = sm.getAvailableServer();
    assert.ok(result, 'should return a non-null server');
    assert.equal(result.id, 'server-2', 'should skip offline server-1 and return server-2');
  });

  it('returns null when all servers are offline', () => {
    sm.loadServers(makeServers());
    sm.statusMap['server-1'] = 'offline';
    sm.statusMap['server-2'] = 'offline';
    const result = sm.getAvailableServer();
    assert.equal(result, null, 'should return null when all servers are offline');
  });

  it('returns the connected server if it has highest priority', () => {
    sm.loadServers(makeServers());
    sm.statusMap['server-1'] = 'connected';
    const result = sm.getAvailableServer();
    assert.equal(result.id, 'server-1', 'connected status should not be treated as offline');
  });

  it('handles single non-offline server', () => {
    sm.loadServers([{ id: 'only-one', host: 'solo.local', port: 25565, priority: 1, maxAgents: 1 }]);
    const result = sm.getAvailableServer();
    assert.equal(result.id, 'only-one', 'should return the only available server');
  });
});

// ── connect() ───────────────────────────────────────────────────────

describe('ServerManager — connect()', () => {
  let sm;
  let board;

  beforeEach(() => {
    board = makeBoard();
    sm = new ServerManager({ board, servers: makeServers() });
  });

  it('returns { serverId, status: connected }', async () => {
    const result = await sm.connect('server-1');
    assert.deepEqual(result, { serverId: 'server-1', status: 'connected' }, 'should return correct result object');
  });

  it('updates statusMap to connected', async () => {
    await sm.connect('server-1');
    assert.equal(sm.statusMap['server-1'], 'connected', 'statusMap should show connected');
  });

  it('calls board.setConfig with correct key and status payload', async () => {
    await sm.connect('server-1');
    assert.equal(board.setConfig.mock.calls.length, 1, 'setConfig should be called once');
    const [key, payload] = board.setConfig.mock.calls[0].arguments;
    assert.equal(key, 'servers:server-1:status', 'setConfig key should match pattern');
    assert.equal(payload.status, 'connected', 'payload status should be connected');
    assert.equal(payload.serverId, 'server-1', 'payload serverId should match');
  });

  it('calls board.publish with status channel and correct data', async () => {
    await sm.connect('server-1');
    assert.equal(board.publish.mock.calls.length, 1, 'publish should be called once');
    const [channel, data] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'servers:status:updated', 'publish channel should be servers:status:updated');
    assert.equal(data.serverId, 'server-1', 'publish data serverId should match');
    assert.equal(data.status, 'connected', 'publish data status should be connected');
    assert.equal(data.author, 'server-manager', 'publish data author should be server-manager');
  });

  it('includes author field in publish call', async () => {
    await sm.connect('server-2');
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.author, 'server-manager', 'author field must be server-manager');
  });
});

// ── disconnect() ────────────────────────────────────────────────────

describe('ServerManager — disconnect()', () => {
  let sm;
  let board;

  beforeEach(() => {
    board = makeBoard();
    sm = new ServerManager({ board, servers: makeServers() });
  });

  it('returns { serverId, status: disconnected }', async () => {
    const result = await sm.disconnect('server-1');
    assert.deepEqual(result, { serverId: 'server-1', status: 'disconnected' }, 'should return correct result object');
  });

  it('updates statusMap to disconnected', async () => {
    await sm.disconnect('server-1');
    assert.equal(sm.statusMap['server-1'], 'disconnected', 'statusMap should show disconnected');
  });

  it('calls board.setConfig with disconnected status', async () => {
    await sm.disconnect('server-1');
    assert.equal(board.setConfig.mock.calls.length, 1, 'setConfig should be called once');
    const [key, payload] = board.setConfig.mock.calls[0].arguments;
    assert.equal(key, 'servers:server-1:status', 'setConfig key should match pattern');
    assert.equal(payload.status, 'disconnected', 'payload status should be disconnected');
  });

  it('calls board.publish with disconnected status and author', async () => {
    await sm.disconnect('server-1');
    assert.equal(board.publish.mock.calls.length, 1, 'publish should be called once');
    const [channel, data] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'servers:status:updated', 'publish channel should be servers:status:updated');
    assert.equal(data.status, 'disconnected', 'publish data status should be disconnected');
    assert.equal(data.author, 'server-manager', 'publish data author should be server-manager');
  });

  it('can disconnect a server that was previously connected', async () => {
    await sm.connect('server-1');
    board.setConfig.mock.resetCalls();
    board.publish.mock.resetCalls();
    await sm.disconnect('server-1');
    assert.equal(sm.statusMap['server-1'], 'disconnected', 'should transition from connected to disconnected');
  });
});

// ── setOffline() ─────────────────────────────────────────────────────

describe('ServerManager — setOffline()', () => {
  let sm;
  let board;

  beforeEach(() => {
    board = makeBoard();
    sm = new ServerManager({ board, servers: makeServers() });
  });

  it('updates statusMap to offline', async () => {
    await sm.setOffline('server-1');
    assert.equal(sm.statusMap['server-1'], 'offline', 'statusMap should show offline');
  });

  it('calls board.publish when set offline', async () => {
    await sm.setOffline('server-1');
    assert.equal(board.publish.mock.calls.length, 1, 'publish should be called once');
  });

  it('publishes correct status and author', async () => {
    await sm.setOffline('server-2');
    const [channel, data] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'servers:status:updated', 'channel should be servers:status:updated');
    assert.equal(data.serverId, 'server-2', 'data serverId should be server-2');
    assert.equal(data.status, 'offline', 'data status should be offline');
    assert.equal(data.author, 'server-manager', 'data author should be server-manager');
  });

  it('calls board.setConfig with offline status', async () => {
    await sm.setOffline('server-1');
    assert.equal(board.setConfig.mock.calls.length, 1, 'setConfig should be called once');
    const [key, payload] = board.setConfig.mock.calls[0].arguments;
    assert.equal(key, 'servers:server-1:status', 'setConfig key should match pattern');
    assert.equal(payload.status, 'offline', 'payload status should be offline');
  });

  it('getAvailableServer skips server after setOffline', async () => {
    sm.loadServers([{ id: 'server-a', host: 'a.local', port: 25565, priority: 1, maxAgents: 5 }]);
    await sm.setOffline('server-a');
    const result = sm.getAvailableServer();
    assert.equal(result, null, 'offline server should not be available');
  });
});

// ── checkStatus() ────────────────────────────────────────────────────

describe('ServerManager — checkStatus()', () => {
  let sm;
  let board;

  beforeEach(() => {
    board = makeBoard();
    sm = new ServerManager({ board, servers: makeServers() });
  });

  it('returns unknown for untracked server', () => {
    const result = sm.checkStatus('nonexistent');
    assert.deepEqual(result, { serverId: 'nonexistent', status: 'unknown' }, 'should return unknown for untracked server');
  });

  it('returns correct status after connect', async () => {
    await sm.connect('server-1');
    const result = sm.checkStatus('server-1');
    assert.deepEqual(result, { serverId: 'server-1', status: 'connected' }, 'should return connected after connect');
  });

  it('returns correct status after disconnect', async () => {
    await sm.connect('server-1');
    await sm.disconnect('server-1');
    const result = sm.checkStatus('server-1');
    assert.deepEqual(result, { serverId: 'server-1', status: 'disconnected' }, 'should return disconnected after disconnect');
  });

  it('returns correct status after setOffline', async () => {
    await sm.setOffline('server-2');
    const result = sm.checkStatus('server-2');
    assert.deepEqual(result, { serverId: 'server-2', status: 'offline' }, 'should return offline after setOffline');
  });

  it('returns object with serverId field', () => {
    const result = sm.checkStatus('server-1');
    assert.ok('serverId' in result, 'result should have serverId field');
    assert.ok('status' in result, 'result should have status field');
  });
});

// ── publishStatus() ──────────────────────────────────────────────────

describe('ServerManager — publishStatus()', () => {
  let sm;
  let board;

  beforeEach(() => {
    board = makeBoard();
    sm = new ServerManager({ board, servers: makeServers() });
  });

  it('calls board.setConfig with correct key and payload', async () => {
    await sm.publishStatus('server-1', 'connected');
    assert.equal(board.setConfig.mock.calls.length, 1, 'setConfig should be called once');
    const [key, payload] = board.setConfig.mock.calls[0].arguments;
    assert.equal(key, 'servers:server-1:status', 'key should match pattern');
    assert.equal(payload.status, 'connected', 'payload status should match');
    assert.equal(payload.serverId, 'server-1', 'payload serverId should match');
  });

  it('calls board.publish with correct channel and author', async () => {
    await sm.publishStatus('server-2', 'disconnected');
    assert.equal(board.publish.mock.calls.length, 1, 'publish should be called once');
    const [channel, data] = board.publish.mock.calls[0].arguments;
    assert.equal(channel, 'servers:status:updated', 'channel should be servers:status:updated');
    assert.equal(data.author, 'server-manager', 'author should be server-manager');
    assert.equal(data.status, 'disconnected', 'status should be disconnected');
    assert.equal(data.serverId, 'server-2', 'serverId should match');
  });

  it('works for offline status', async () => {
    await sm.publishStatus('server-1', 'offline');
    const [, data] = board.publish.mock.calls[0].arguments;
    assert.equal(data.status, 'offline', 'should publish offline status');
  });
});
