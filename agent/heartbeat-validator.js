/**
 * Octiv HeartbeatValidator — Requirement 3
 * Tracks agent liveness via periodic heartbeat checks.
 * - recordHeartbeat: stores timestamp at agents:heartbeat:{agentId}
 * - isStale: returns true if heartbeat is missing or > staleThresholdMs old
 * - checkAll: marks stale agents inactive and publishes discord:alert
 * - start/stop: manage the polling interval
 */
const { getLogger } = require('./logger');
const log = getLogger();

class HeartbeatValidator {
  /**
   * @param {object} options
   * @param {object} options.board - Blackboard instance (set/get/publish)
   * @param {number} [options.intervalMs=30000] - polling interval in ms
   * @param {number} [options.staleThresholdMs=60000] - age limit before agent is stale
   */
  constructor({ board, intervalMs = 30000, staleThresholdMs = 60000 }) {
    this.board = board;
    this.intervalMs = intervalMs;
    this.staleThresholdMs = staleThresholdMs;
    this.agents = new Set(); // Set of registered agentIds
    this._timer = null;
  }

  /**
   * Record a heartbeat for the given agent.
   * Stores current timestamp at agents:heartbeat:{agentId}.
   * Also registers the agent in the internal Set.
   * @param {string} agentId
   */
  async recordHeartbeat(agentId) {
    this.agents.add(agentId);
    await this.board.set(`agents:heartbeat:${agentId}`, Date.now());
    log.info('heartbeat-validator', `heartbeat recorded: ${agentId}`);
  }

  /**
   * Check whether the given agent's heartbeat is stale.
   * Returns true if the timestamp is missing or older than staleThresholdMs.
   * @param {string} agentId
   * @returns {Promise<boolean>}
   */
  async isStale(agentId) {
    const ts = await this.board.get(`agents:heartbeat:${agentId}`);
    if (ts === null || ts === undefined) return true;
    return Date.now() - ts >= this.staleThresholdMs;
  }

  /**
   * Mark agent as inactive: update status in Blackboard and send Discord alert.
   * @param {string} agentId
   */
  async handleInactive(agentId) {
    const statusValue = { agentId, status: 'inactive', ts: Date.now() };
    await this.board.set(`agents:status:${agentId}`, statusValue);
    await this.board.publish('discord:alert', {
      author: 'heartbeat-validator',
      agentId,
      status: 'inactive',
      message: `Agent ${agentId} has gone inactive (heartbeat timed out)`,
    });
    log.warn('heartbeat-validator', `agent inactive: ${agentId}`);
  }

  /**
   * Iterate all registered agents.
   * Calls handleInactive for any whose heartbeat is stale.
   */
  async checkAll() {
    for (const agentId of this.agents) {
      const stale = await this.isStale(agentId);
      if (stale) {
        await this.handleInactive(agentId);
      }
    }
  }

  /**
   * Start the periodic heartbeat check.
   * Clears any existing timer before creating a new one.
   */
  start() {
    if (this._timer !== null) {
      clearInterval(this._timer);
    }
    this._timer = setInterval(() => {
      this.checkAll().catch((err) => {
        log.error('heartbeat-validator', 'checkAll error', { error: err.message });
      });
    }, this.intervalMs);
    log.info('heartbeat-validator', `started (interval=${this.intervalMs}ms, stale=${this.staleThresholdMs}ms)`);
  }

  /**
   * Stop the periodic heartbeat check.
   * Safe to call even if start() was never called.
   */
  stop() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = { HeartbeatValidator };
