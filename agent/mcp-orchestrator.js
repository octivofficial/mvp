/**
 * Octiv Multi-Agent MCP Orchestrator — Phase 3.4
 * Agent registry, task routing, broadcast commands via Blackboard
 */
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const log = getLogger();

class MCPOrchestrator {
  constructor({ heartbeatValidator } = {}) {
    this.board = new Blackboard();
    this.agents = new Map(); // agentId -> { role, status, registeredAt }
    this.heartbeatValidator = heartbeatValidator || null;
  }

  async init() {
    await this.board.connect();
    // Load existing registry from Redis
    const registry = await this.board.getHash('agents:registry');
    for (const [id, raw] of Object.entries(registry)) {
      try { this.agents.set(id, JSON.parse(raw)); } catch {}
    }
    log.info('orchestrator', `initialized, ${this.agents.size} agents registered`);
  }

  async registerAgent(agentId, role, metadata = {}) {
    const entry = { role, status: 'active', registeredAt: Date.now(), ...metadata };
    this.agents.set(agentId, entry);
    await this.board.setHashField('agents:registry', agentId, entry);
    await this.board.publish('orchestrator:registered', { author: 'orchestrator', agentId, role });
    // Record initial heartbeat if validator is injected (Requirement 3)
    if (this.heartbeatValidator) {
      await this.heartbeatValidator.recordHeartbeat(agentId);
    }
    log.info('orchestrator', `registered: ${agentId} (${role})`);
    return entry;
  }

  async deregisterAgent(agentId) {
    this.agents.delete(agentId);
    await this.board.deleteHashField('agents:registry', agentId);
    await this.board.publish('orchestrator:deregistered', { author: 'orchestrator', agentId });
    log.info('orchestrator', `deregistered: ${agentId}`);
  }

  async getAllAgents() {
    return Object.fromEntries(this.agents);
  }

  async getAgentsByRole(role) {
    const result = {};
    for (const [id, data] of this.agents) {
      if (data.role === role) result[id] = data;
    }
    return result;
  }

  async assignTask(agentId, task) {
    if (!this.agents.has(agentId)) throw new Error(`Agent not registered: ${agentId}`);
    await this.board.publish(`command:${agentId}:task`, { author: 'orchestrator', ...task });
    log.info('orchestrator', `task assigned: ${agentId} → ${task.action}`);
    return { agentId, task, status: 'assigned' };
  }

  async broadcastCommand(command) {
    const targets = [];
    const entries = [];
    for (const [id] of this.agents) {
      entries.push({ channel: `command:${id}:broadcast`, data: { author: 'orchestrator', ...command } });
      targets.push(id);
    }
    // Use batchPublish for ~77% latency reduction vs sequential publishes
    if (entries.length > 0) {
      await this.board.batchPublish(entries);
    }
    log.info('orchestrator', `broadcast to ${targets.length} agents: ${command.action}`);
    return { targets, command, status: 'broadcast' };
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { MCPOrchestrator };
