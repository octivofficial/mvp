'use strict';

/**
 * NotebookLMMCP — Phase 6 Knowledge Bridge
 *
 * Provides an HTTP-based MCP server that wraps an injected apiClient
 * for two operations:
 *   - searchDocs(query, limit)  — document search via NotebookLM
 *   - syncProgress(acData)      — push AC status to NotebookLM
 *
 * The HTTP server itself is intentionally minimal; it only needs to be
 * started / stopped.  Actual tool dispatch happens through the methods
 * directly (consumed by the Leader agent or KnowledgeRouter).
 *
 * Dependency injection keeps the class fully unit-testable without
 * touching real ports or a live NotebookLM API:
 *
 *   new NotebookLMMCP({ port, notebookId, apiClient, httpModule })
 */

const defaultHttp = require('http');

class NotebookLMMCP {
  /**
   * @param {object} opts
   * @param {number}  [opts.port=3100]        - HTTP port for MCP server
   * @param {string}   opts.notebookId         - NotebookLM notebook ID string
   * @param {object}   opts.apiClient          - Injected client with searchDocs / syncProgress
   * @param {object}  [opts.httpModule]        - Injected http module (for testing)
   */
  constructor({ port = 3100, notebookId, apiClient, httpModule = defaultHttp } = {}) {
    this.port = port;
    this.notebookId = notebookId;
    this.apiClient = apiClient;
    this._http = httpModule;

    /** @type {import('http').Server|null} */
    this.server = null;
  }

  // ── start() ──────────────────────────────────────────────────

  /**
   * Start the HTTP MCP server.
   * @returns {Promise<{port: number, status: 'running'|'already_running'}>}
   */
  async start() {
    if (this.server !== null) {
      return { port: this.port, status: 'already_running' };
    }

    const server = this._http.createServer();
    await new Promise((resolve) => server.listen(this.port, () => resolve()));
    this.server = server;
    return { port: this.port, status: 'running' };
  }

  // ── stop() ───────────────────────────────────────────────────

  /**
   * Stop the HTTP MCP server.
   * @returns {Promise<{status: 'stopped'|'not_running'}>}
   */
  async stop() {
    if (this.server === null) {
      return { status: 'not_running' };
    }

    const server = this.server;
    await new Promise((resolve) => server.close(() => resolve()));
    this.server = null;
    return { status: 'stopped' };
  }

  // ── searchDocs() ─────────────────────────────────────────────

  /**
   * Search documents via the injected apiClient.
   * @param {string} query
   * @param {number} [limit=5]
   * @returns {Promise<Array<{title: string, content: string, relevance: number}>>}
   */
  async searchDocs(query, limit = 5) {
    try {
      const results = await this.apiClient.searchDocs(query, limit);
      if (!results || !Array.isArray(results)) {
        return [];
      }
      // Honour the limit — slice in case apiClient returns more than requested.
      return results.slice(0, limit);
    } catch (_err) {
      return [];
    }
  }

  // ── syncProgress() ──────────────────────────────────────────

  /**
   * Push AC status data to NotebookLM via the injected apiClient.
   * @param {object} acData - AC completion data
   * @returns {Promise<{success: true}|{success: false, error: string}>}
   */
  async syncProgress(acData) {
    try {
      await this.apiClient.syncProgress(acData);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  // ── getStatus() ──────────────────────────────────────────────

  /**
   * Return the current status of the MCP server.
   * @returns {{running: boolean, port: number, notebookId: string}}
   */
  getStatus() {
    return {
      running: this.server !== null,
      port: this.port,
      notebookId: this.notebookId,
    };
  }
}

module.exports = { NotebookLMMCP };
