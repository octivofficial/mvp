/**
 * MCP Orchestrator Integration Tests — Property-Based Testing
 * Tests BEFORE implementation (TDD Red phase)
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Blackboard } = require('../agent/blackboard');
const { MCPOrchestrator } = require('../agent/mcp-orchestrator');

describe('MCP Orchestrator Integration', () => {
  let board;
  let orchestrator;

  beforeEach(async () => {
    board = new Blackboard();
    await board.connect();
    // Clear registry before each test
    await board.client.del('octiv:agents:registry');
    orchestrator = new MCPOrchestrator();
    await orchestrator.init();
  });

  afterEach(async () => {
    await orchestrator.shutdown();
    await board.disconnect();
  });

  // Property 1: Registration completeness
  it('should register all 7 agents when team starts', async () => {
    const agents = [
      { id: 'leader-01', role: 'leader' },
      { id: 'builder-01', role: 'builder' },
      { id: 'builder-02', role: 'builder' },
      { id: 'builder-03', role: 'builder' },
      { id: 'safety-01', role: 'safety' },
      { id: 'explorer-01', role: 'explorer' },
      { id: 'miner-01', role: 'miner' },
    ];

    for (const agent of agents) {
      await orchestrator.registerAgent(agent.id, agent.role);
    }

    const registry = await board.getHash('agents:registry');
    assert.strictEqual(Object.keys(registry).length, 7, 'Must register all 7 agents');
    
    for (const agent of agents) {
      assert.ok(registry[agent.id], `${agent.id} must be registered`);
    }
  });

  // Property 2: Deregistration on shutdown
  it('should deregister agent when it shuts down', async () => {
    await orchestrator.registerAgent('test-agent', 'builder');
    
    let registry = await board.getHash('agents:registry');
    assert.ok(registry['test-agent'], 'Agent must be registered');
    
    await orchestrator.deregisterAgent('test-agent');
    
    registry = await board.getHash('agents:registry');
    assert.ok(!registry['test-agent'], 'Agent must be deregistered');
  });

  // Property 3: Registry consistency
  it('should maintain consistent registry count', async () => {
    const agents = ['agent-1', 'agent-2', 'agent-3'];
    
    for (const id of agents) {
      await orchestrator.registerAgent(id, 'builder');
    }
    
    let registry = await board.getHash('agents:registry');
    assert.strictEqual(Object.keys(registry).length, 3, 'Registry count must match');
    
    await orchestrator.deregisterAgent('agent-2');
    
    registry = await board.getHash('agents:registry');
    assert.strictEqual(Object.keys(registry).length, 2, 'Registry count must update');
  });

  // Property 4: getAllAgents returns correct data
  it('should return all registered agents via getAllAgents', async () => {
    await orchestrator.registerAgent('leader-01', 'leader');
    await orchestrator.registerAgent('builder-01', 'builder');
    
    const agents = await orchestrator.getAllAgents();
    
    assert.strictEqual(Object.keys(agents).length, 2, 'Must return 2 agents');
    assert.ok(agents['leader-01'], 'Leader must be in registry');
    assert.ok(agents['builder-01'], 'Builder must be in registry');
  });

  // Property 5: Duplicate registration handling
  it('should handle duplicate registration gracefully', async () => {
    await orchestrator.registerAgent('test-agent', 'builder');
    await orchestrator.registerAgent('test-agent', 'builder'); // duplicate
    
    const registry = await board.getHash('agents:registry');
    const count = Object.keys(registry).filter(k => k === 'test-agent').length;
    
    assert.strictEqual(count, 1, 'Must not create duplicates');
  });

  // Property 6: Role metadata preservation
  it('should preserve role metadata in registry', async () => {
    await orchestrator.registerAgent('miner-01', 'miner');
    
    const registry = await board.getHash('agents:registry');
    const data = JSON.parse(registry['miner-01']);
    
    assert.strictEqual(data.role, 'miner', 'Role must be preserved');
    assert.ok(data.registeredAt, 'Registration timestamp must exist');
  });

  // Property 7: Broadcast command publishes to all registered agent channels
  it('should broadcast command to all registered agents', async () => {
    await orchestrator.registerAgent('agent-1', 'builder');
    await orchestrator.registerAgent('agent-2', 'builder');

    const result = await orchestrator.broadcastCommand({ action: 'test' });

    assert.strictEqual(result.targets.length, 2, 'Must target both agents');
    assert.ok(result.targets.includes('agent-1'), 'Must include agent-1');
    assert.ok(result.targets.includes('agent-2'), 'Must include agent-2');
    assert.strictEqual(result.status, 'broadcast');
  });

  // Property 8: Task assignment to specific agent via publish
  it('should assign task to specific agent', async () => {
    await orchestrator.registerAgent('builder-01', 'builder');

    const result = await orchestrator.assignTask('builder-01', { action: 'collect_wood' });

    assert.strictEqual(result.agentId, 'builder-01', 'Must target correct agent');
    assert.strictEqual(result.task.action, 'collect_wood', 'Task content must match');
    assert.strictEqual(result.status, 'assigned');
  });

  // Property 9: Empty registry handling
  it('should handle empty registry gracefully', async () => {
    const agents = await orchestrator.getAllAgents();
    assert.strictEqual(Object.keys(agents).length, 0, 'Empty registry must return empty object');
  });

  // Property 10: Concurrent registration
  it('should handle concurrent registrations', async () => {
    const promises = [];
    for (let i = 1; i <= 5; i++) {
      promises.push(orchestrator.registerAgent(`agent-${i}`, 'builder'));
    }
    
    await Promise.all(promises);
    
    const registry = await board.getHash('agents:registry');
    assert.strictEqual(Object.keys(registry).length, 5, 'All concurrent registrations must succeed');
  });
});
