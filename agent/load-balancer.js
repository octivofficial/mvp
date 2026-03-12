/**
 * LoadBalancer — selects Minecraft servers for new agents based on current load.
 * Supports load-ratio-based selection, per-server agent tracking, and rebalance suggestions.
 */

class LoadBalancer {
  /**
   * @param {Object} options
   * @param {Array<{id: string, host: string, port: number, priority: number, maxAgents: number}>} options.servers
   */
  constructor({ servers = [] } = {}) {
    /** @type {Map<string, {id: string, host: string, port: number, priority: number, maxAgents: number, agentCount: number}>} */
    this.servers = new Map();
    for (const config of servers) {
      this.servers.set(config.id, { ...config, agentCount: 0 });
    }
  }

  /**
   * Select the best server for a new agent.
   * Filters out full servers, then picks the one with the lowest load ratio.
   * Ties broken by lower priority number.
   * @returns {Object|null} server config or null if all at capacity
   */
  selectServer() {
    const available = [];
    for (const server of this.servers.values()) {
      if (server.agentCount < server.maxAgents) {
        available.push(server);
      }
    }
    if (available.length === 0) return null;

    available.sort((a, b) => {
      const ratioA = a.agentCount / a.maxAgents;
      const ratioB = b.agentCount / b.maxAgents;
      if (ratioA !== ratioB) return ratioA - ratioB;
      return a.priority - b.priority;
    });

    return available[0];
  }

  /**
   * Get load statistics for a specific server.
   * @param {string} serverId
   * @returns {{serverId: string, agentCount: number, maxAgents: number, loadRatio: number}|null}
   */
  getServerLoad(serverId) {
    const server = this.servers.get(serverId);
    if (!server) return null;
    return {
      serverId: server.id,
      agentCount: server.agentCount,
      maxAgents: server.maxAgents,
      loadRatio: server.agentCount / server.maxAgents,
    };
  }

  /**
   * Increment agentCount for a server.
   * @param {string} serverId
   * @returns {number} new agentCount
   * @throws {Error} if server not found
   */
  addAgent(serverId) {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);
    server.agentCount += 1;
    return server.agentCount;
  }

  /**
   * Decrement agentCount for a server (floor at 0).
   * @param {string} serverId
   * @returns {number} new agentCount
   * @throws {Error} if server not found
   */
  removeAgent(serverId) {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);
    server.agentCount = Math.max(0, server.agentCount - 1);
    return server.agentCount;
  }

  /**
   * Generate move suggestions to rebalance load.
   * Identifies servers over 80% load and suggests moving agents to servers under 50% load.
   * Does NOT mutate state — suggestions only.
   * @returns {Array<{agentId: string, from: string, to: string}>}
   */
  rebalance() {
    const suggestions = [];

    const overloaded = [];
    const underloaded = [];

    for (const server of this.servers.values()) {
      const ratio = server.agentCount / server.maxAgents;
      if (ratio > 0.8) overloaded.push(server);
      else if (ratio < 0.5) underloaded.push(server);
    }

    if (overloaded.length === 0 || underloaded.length === 0) return suggestions;

    let targetIndex = 0;
    for (const src of overloaded) {
      // suggest moving excess agents (those above 80% threshold)
      const excessCount = src.agentCount - Math.floor(src.maxAgents * 0.8);
      for (let i = 0; i < excessCount; i++) {
        if (targetIndex >= underloaded.length) break;
        const dest = underloaded[targetIndex];
        suggestions.push({
          agentId: `agent-${src.id}-${i}`,
          from: src.id,
          to: dest.id,
        });
        // advance target when it would become >= 50% after absorbing this move
        const destRatioAfter = (dest.agentCount + suggestions.filter(s => s.to === dest.id).length) / dest.maxAgents;
        if (destRatioAfter >= 0.5) targetIndex++;
      }
    }

    return suggestions;
  }
}

module.exports = { LoadBalancer };
