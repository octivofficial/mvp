/**
 * Phase 11 — MCPOrchestrator integration wiring tests
 * Verifies optional injection of ServerManager, LoadBalancer, KnowledgeRouter
 * Uses mock board and mock components (no real Redis).
 */
const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { MCPOrchestrator } = require('../agent/mcp-orchestrator');

// ── Mocks ──────────────────────────────────────────────────────────────────

const makeBoard = () => ({
  connect: mock.fn(async () => {}),
  disconnect: mock.fn(async () => {}),
  getHash: mock.fn(async () => ({})),
  setHashField: mock.fn(async () => {}),
  deleteHashField: mock.fn(async () => {}),
  publish: mock.fn(async () => {}),
  batchPublish: mock.fn(async () => {}),
});

const makeHeartbeat = () => ({
  recordHeartbeat: mock.fn(async () => {}),
});

const makeLoadBalancer = (server = { id: 'srv-1' }) => ({
  selectServer: mock.fn(() => server),
  addAgent: mock.fn(() => 1),
});

const makeServerManager = () => ({
  connect: mock.fn(async () => ({ serverId: 'srv-1', status: 'connected' })),
});

const makeKnowledgeRouter = (answer = 'routed answer') => ({
  route: mock.fn(async () => answer),
});

const makeOrchestrator = (opts = {}) => {
  const orch = new MCPOrchestrator(opts);
  orch.board = makeBoard(); // replace real Blackboard with mock
  return orch;
};

// ── constructor ────────────────────────────────────────────────────────────

describe('MCPOrchestrator — Phase 11 wiring — constructor', () => {
  it('stores serverManager', () => {
    const sm = makeServerManager();
    const orch = makeOrchestrator({ serverManager: sm });
    assert.equal(orch.serverManager, sm);
  });

  it('stores loadBalancer', () => {
    const lb = makeLoadBalancer();
    const orch = makeOrchestrator({ loadBalancer: lb });
    assert.equal(orch.loadBalancer, lb);
  });

  it('stores knowledgeRouter', () => {
    const kr = makeKnowledgeRouter();
    const orch = makeOrchestrator({ knowledgeRouter: kr });
    assert.equal(orch.knowledgeRouter, kr);
  });

  it('defaults all optional components to null', () => {
    const orch = makeOrchestrator();
    assert.equal(orch.serverManager, null);
    assert.equal(orch.loadBalancer, null);
    assert.equal(orch.knowledgeRouter, null);
  });
});

// ── registerAgent with LoadBalancer + ServerManager ───────────────────────

describe('MCPOrchestrator — registerAgent with LoadBalancer', () => {
  it('calls loadBalancer.selectServer() when loadBalancer is injected', async () => {
    const lb = makeLoadBalancer();
    const orch = makeOrchestrator({ loadBalancer: lb });
    await orch.registerAgent('bot-1', 'builder');
    assert.equal(lb.selectServer.mock.callCount(), 1);
  });

  it('calls loadBalancer.addAgent() with selected server id', async () => {
    const lb = makeLoadBalancer({ id: 'server-42' });
    const orch = makeOrchestrator({ loadBalancer: lb });
    await orch.registerAgent('bot-1', 'builder');
    assert.equal(lb.addAgent.mock.callCount(), 1);
    const [calledServerId] = lb.addAgent.mock.calls[0].arguments;
    assert.equal(calledServerId, 'server-42');
  });

  it('calls serverManager.connect() when both loadBalancer and serverManager injected', async () => {
    const sm = makeServerManager();
    const lb = makeLoadBalancer({ id: 'srv-1' });
    const orch = makeOrchestrator({ loadBalancer: lb, serverManager: sm });
    await orch.registerAgent('bot-1', 'builder');
    assert.equal(sm.connect.mock.callCount(), 1);
    const [connectedId] = sm.connect.mock.calls[0].arguments;
    assert.equal(connectedId, 'srv-1');
  });

  it('sets entry.serverId from selected server', async () => {
    const lb = makeLoadBalancer({ id: 'srv-99' });
    const orch = makeOrchestrator({ loadBalancer: lb });
    const entry = await orch.registerAgent('bot-1', 'builder');
    assert.equal(entry.serverId, 'srv-99');
  });

  it('skips serverManager.connect() when loadBalancer returns null', async () => {
    const sm = makeServerManager();
    const lb = makeLoadBalancer(null); // no server available
    const orch = makeOrchestrator({ loadBalancer: lb, serverManager: sm });
    await orch.registerAgent('bot-1', 'builder');
    assert.equal(sm.connect.mock.callCount(), 0);
  });

  it('does not set serverId when no server available', async () => {
    const lb = makeLoadBalancer(null);
    const orch = makeOrchestrator({ loadBalancer: lb });
    const entry = await orch.registerAgent('bot-1', 'builder');
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'serverId'), false);
  });

  it('still calls heartbeatValidator when loadBalancer present', async () => {
    const hb = makeHeartbeat();
    const lb = makeLoadBalancer();
    const orch = makeOrchestrator({ heartbeatValidator: hb, loadBalancer: lb });
    await orch.registerAgent('bot-1', 'builder');
    assert.equal(hb.recordHeartbeat.mock.callCount(), 1);
  });
});

// ── query() via KnowledgeRouter ───────────────────────────────────────────

describe('MCPOrchestrator — query() with KnowledgeRouter', () => {
  it('returns null when no knowledgeRouter injected', async () => {
    const orch = makeOrchestrator();
    const result = await orch.query('what is the weather?');
    assert.equal(result, null);
  });

  it('calls knowledgeRouter.route() with the question', async () => {
    const kr = makeKnowledgeRouter('42');
    const orch = makeOrchestrator({ knowledgeRouter: kr });
    await orch.query('test question');
    assert.equal(kr.route.mock.callCount(), 1);
    const [arg] = kr.route.mock.calls[0].arguments;
    assert.equal(arg, 'test question');
  });

  it('returns the routed answer from knowledgeRouter', async () => {
    const kr = makeKnowledgeRouter('deep knowledge');
    const orch = makeOrchestrator({ knowledgeRouter: kr });
    const result = await orch.query('complex question');
    assert.equal(result, 'deep knowledge');
  });

  it('propagates errors from knowledgeRouter.route()', async () => {
    const kr = { route: mock.fn(async () => { throw new Error('router down'); }) };
    const orch = makeOrchestrator({ knowledgeRouter: kr });
    await assert.rejects(() => orch.query('question'), /router down/);
  });
});
