/**
 * ServerManager — Phase 8
 * Manages multi-server connection state and publishes status updates
 * to the Blackboard for agent coordination.
 */

class ServerManager {
  /**
   * @param {object} options
   * @param {object} options.board - Blackboard instance (setConfig + publish)
   * @param {Array}  options.servers - Initial server config array
   */
  constructor({ board, servers = [] }) {
    this.board = board;
    this.servers = [...servers];
    this.statusMap = {};
  }

  /**
   * Load (replace) the server list.
   * @param {Array} serverConfigs - Array of { id, host, port, priority, maxAgents }
   * @returns {number} Count of servers loaded
   */
  loadServers(serverConfigs) {
    this.servers = [...serverConfigs];
    return this.servers.length;
  }

  /**
   * Return the highest-priority server that is not offline.
   * Lowest priority number = highest priority.
   * @returns {object|null} Server config or null if none available
   */
  getAvailableServer() {
    const sorted = [...this.servers].sort((a, b) => a.priority - b.priority);
    for (const server of sorted) {
      if (this.statusMap[server.id] !== 'offline') {
        return server;
      }
    }
    return null;
  }

  /**
   * Mark a server as connected and publish the status change.
   * @param {string} serverId
   * @returns {Promise<{ serverId: string, status: string }>}
   */
  async connect(serverId) {
    const status = 'connected';
    this.statusMap[serverId] = status;
    await this.publishStatus(serverId, status);
    return { serverId, status };
  }

  /**
   * Mark a server as disconnected and publish the status change.
   * @param {string} serverId
   * @returns {Promise<{ serverId: string, status: string }>}
   */
  async disconnect(serverId) {
    const status = 'disconnected';
    this.statusMap[serverId] = status;
    await this.publishStatus(serverId, status);
    return { serverId, status };
  }

  /**
   * Mark a server as offline and publish the status change.
   * @param {string} serverId
   * @returns {Promise<void>}
   */
  async setOffline(serverId) {
    const status = 'offline';
    this.statusMap[serverId] = status;
    await this.publishStatus(serverId, status);
  }

  /**
   * Return the current tracked status for a server.
   * @param {string} serverId
   * @returns {{ serverId: string, status: string }}
   */
  checkStatus(serverId) {
    const status = this.statusMap[serverId] || 'unknown';
    return { serverId, status };
  }

  /**
   * Publish a status update via board.setConfig and board.publish.
   * @param {string} serverId
   * @param {string} status
   * @returns {Promise<void>}
   */
  async publishStatus(serverId, status) {
    const key = `servers:${serverId}:status`;
    const payload = { status, serverId };
    await this.board.setConfig(key, payload);
    await this.board.publish('servers:status:updated', {
      serverId,
      status,
      author: 'server-manager',
    });
  }
}

module.exports = { ServerManager };
