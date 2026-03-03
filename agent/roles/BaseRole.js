/**
 * Octiv Base Role — Phase 3.5
 * Abstract base for specialized agent roles.
 * Subclasses implement execute() with role-specific behavior.
 */
const { Blackboard } = require('../blackboard');

class BaseRole {
  constructor(config = {}) {
    this.id = config.id || 'agent-01';
    this.role = config.role || 'base';
    this.board = new Blackboard();
    this.status = 'idle';
  }

  async init() {
    await this.board.connect();
    await this.board.client.hSet('octiv:agents:registry', this.id, JSON.stringify({
      role: this.role, status: 'active', registeredAt: Date.now(),
    }));
    console.log(`[${this.role}:${this.id}] initialized`);
  }

  async execute() {
    throw new Error('Subclass must implement execute()');
  }

  async reportStatus(status) {
    this.status = status;
    await this.board.publish(`agent:${this.id}:status`, { author: this.id, role: this.role, status });
  }

  async shutdown() {
    await this.board.client.hDel('octiv:agents:registry', this.id);
    await this.board.disconnect();
  }
}

module.exports = { BaseRole };
