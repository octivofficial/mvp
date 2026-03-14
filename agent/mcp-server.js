/**
 * Octiv MCP Tool Server — JSON-RPC 2.0 endpoint
 * Phase 2.5: Tools for external LLM/agent control
 * Usage: node agent/mcp-server.js (port 3001)
 */
const http = require('http');
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const log = getLogger();

const PORT = process.env.MCP_PORT || 3001;

class MCPServer {
  constructor(port = PORT) {
    this.port = port;
    this.board = new Blackboard();
    this.server = null;
    this.tools = {
      getStatus: this._getStatus.bind(this),
      moveTo: this._moveTo.bind(this),
      chopTree: this._chopTree.bind(this),
      inventory: this._inventory.bind(this),
      setLLMConfig: this._setLLMConfig.bind(this),
      getLLMConfig: this._getLLMConfig.bind(this),
      analyzeYouTube: this._analyzeYouTube.bind(this),
      notebookDeepResearch: this._notebookDeepResearch.bind(this),
      createDriveFolder: this._createDriveFolder.bind(this),
      exportToGoogleDoc: this._exportToGoogleDoc.bind(this),
      controlObsidian: this._controlObsidian.bind(this),
      getAgentStats: this._getAgentStats.bind(this),
      getReflexionLogs: this._getReflexionLogs.bind(this),
    };
  }

  async start() {
    await this.board.connect();
    // 3.6: Blackboard → MCP sync subscriber
    this.subscriber = await this.board.createSubscriber();
    this._startSync();
    this.server = http.createServer((req, res) => this._handleRequest(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        log.info('mcp-server', `listening on port ${this.port}`);
        resolve();
      });
    });
  }

  // 3.6: Bidirectional Blackboard <-> MCP context sync
  _startSync() {
    this.syncedState = {};
    this.subscriber.pSubscribe('octiv:agent:*:status', (message, channel) => {
      try {
        const data = JSON.parse(message);
        const agentId = channel.split(':')[2];
        this.syncedState[agentId] = { ...data, syncedAt: Date.now() };
      } catch (e) { log.debug('mcp-server', 'status sync parse error', { error: e.message }); }
    });
  }

  getSyncedState() {
    return this.syncedState;
  }

  async stop() {
    if (this.subscriber) {
      await this.subscriber.pUnsubscribe();
      await this.subscriber.disconnect();
    }
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise((resolve) => this.server.close(resolve));
    }
    await this.board.disconnect();
  }

  async _handleRequest(req, res) {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const MAX_BODY = 1024 * 1024; // 1MB
    let body = '';
    let aborted = false;

    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (max 1MB)' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (aborted) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      try {
        const rpc = JSON.parse(body);
        const result = await this._dispatch(rpc);
        res.end(JSON.stringify(result));
      } catch (err) {
        res.end(JSON.stringify(this._errorResponse(null, -32700, 'Parse error')));
      }
    });
  }

  async _dispatch(rpc) {
    if (!rpc.jsonrpc || rpc.jsonrpc !== '2.0' || !rpc.method) {
      return this._errorResponse(rpc.id, -32600, 'Invalid Request');
    }

    const handler = this.tools[rpc.method];
    if (!handler) {
      return this._errorResponse(rpc.id, -32601, `Method not found: ${rpc.method}`);
    }

    try {
      const result = await handler(rpc.params || {});
      return { jsonrpc: '2.0', result, id: rpc.id };
    } catch (err) {
      return this._errorResponse(rpc.id, -32000, err.message);
    }
  }

  _errorResponse(id, code, message) {
    return { jsonrpc: '2.0', error: { code, message }, id: id || null };
  }

  // Input validation helpers
  _validateAgentId(agentId) {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('Required: agentId (non-empty string)');
    }
    if (!/^[a-z0-9:_-]+$/.test(agentId)) {
      throw new Error('Invalid agentId: must be lowercase alphanumeric with : _ -');
    }
  }

  _validateCoordinate(value, name) {
    if (value == null) throw new Error(`Required: ${name}`);
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    const MC_LIMIT = 30_000_000;
    if (value < -MC_LIMIT || value > MC_LIMIT) {
      throw new Error(`${name} out of Minecraft range (±${MC_LIMIT})`);
    }
  }

  // Tool: Get team/agent status from Blackboard
  async _getStatus(params) {
    const agentId = params.agentId;
    if (agentId) {
      this._validateAgentId(agentId);
      const status = await this.board.get(`agent:${agentId}:status`);
      const ac = await this.board.getACProgress(agentId);
      return { agentId, status, ac };
    }
    const team = await this.board.get('team:status');
    return { team };
  }

  // Tool: Command agent to move to coordinates
  async _moveTo(params) {
    const { agentId, x, y, z } = params;
    this._validateAgentId(agentId);
    this._validateCoordinate(x, 'x');
    this._validateCoordinate(y, 'y');
    this._validateCoordinate(z, 'z');
    await this.board.publish(`command:${agentId}:move-to`, { author: 'mcp-server', x, y, z });
    return { agentId, command: 'moveTo', target: { x, y, z }, status: 'dispatched' };
  }

  // Tool: Command agent to chop nearest tree
  async _chopTree(params) {
    const { agentId } = params;
    this._validateAgentId(agentId);
    await this.board.publish(`command:${agentId}:chop-tree`, { author: 'mcp-server', action: 'chopTree' });
    return { agentId, command: 'chopTree', status: 'dispatched' };
  }

  // 4.7: Set LLM config via MCP → persists to Redis
  async _setLLMConfig(params) {
    const { model, temperature, maxTokens } = params;
    const updates = {};
    if (model) updates.model = model;
    if (temperature != null) updates.temperature = temperature;
    if (maxTokens != null) updates.maxTokens = maxTokens;

    const config = await this.board.getConfig('config:llm') || {};
    Object.assign(config, updates);
    await this.board.setConfig('config:llm', config);
    await this.board.publish('config:llm:updated', { author: 'mcp-server', ...config });
    return { config, status: 'updated' };
  }

  // 4.7: Get current LLM config
  async _getLLMConfig() {
    const config = await this.board.getConfig('config:llm');
    return { config: config || {} };
  }

  // Tool: Get agent inventory
  async _inventory(params) {
    const { agentId } = params;
    this._validateAgentId(agentId);
    const inv = await this.board.get(`agent:${agentId}:inventory`);
    return { agentId, inventory: inv || {} };
  }

  // --- YouTube & Research Tools ---

  /**
   * analyzeYouTube: Extract transcript and analyze video
   */
  async _analyzeYouTube(params) {
    const { url } = params;
    if (!url) throw new Error('Required: url');
    await this.board.publish('youtube:task', { action: 'analyze', url, author: 'mcp-server' });
    return { url, command: 'analyzeYouTube', status: 'dispatched' };
  }

  /**
   * notebookDeepResearch: Trigger complex research in NotebookLM
   */
  async _notebookDeepResearch(params) {
    const { sources, notebookId } = params;
    await this.board.publish('notebook:task', { 
      action: 'deep_research', 
      sources, 
      notebookId,
      author: 'mcp-server' 
    });
    return { notebookId, command: 'notebookDeepResearch', status: 'dispatched' };
  }

  // --- Workspace Tools ---

  /**
   * createDriveFolder: Create a folder in Google Drive
   */
  async _createDriveFolder(params) {
    const { name } = params;
    if (!name) throw new Error('Required: name');
    await this.board.publish('workspace:task', { 
      action: 'create_folder', 
      name,
      author: 'mcp-server' 
    });
    return { folderName: name, command: 'createDriveFolder', status: 'dispatched' };
  }

  /**
   * exportToGoogleDoc: Create a Google Doc with PRD/content
   */
  async _exportToGoogleDoc(params) {
    const { title, content } = params;
    if (!title) throw new Error('Required: title');
    await this.board.publish('workspace:task', { 
      action: 'export_prd', 
      title,
      content,
      author: 'mcp-server' 
    });
    return { title, command: 'exportToGoogleDoc', status: 'dispatched' };
  }

  // --- Obsidian CLI Tools ---

  /**
   * controlObsidian: Execute a command via Obsidian URI/CLI
   */
  async _controlObsidian(params) {
    const { action, file, command } = params;
    if (!action) throw new Error('Required: action (open|search|new)');
    await this.board.publish('obsidian:cli:task', { 
      action, 
      file, 
      command,
      author: 'mcp-server' 
    });
    return { action, status: 'dispatched' };
  }

  // --- Observability Tools (Phase 19) ---

  async _getAgentStats(_params) {
    const status = await this.board.get('team:status');
    // Aggregate data from synced state
    return {
        team: status,
        agents: this.syncedState,
        ts: Date.now()
    };
  }

  async _getReflexionLogs(params) {
    const agentId = params.agentId || 'leader-01';
    const logs = await this.board.getListRange(`agent:${agentId}:reflexion`, 0, 19);
    return {
        agentId,
        logs: logs.map(l => {
            try { return JSON.parse(l); } catch { return l; }
        })
    };
  }
}

module.exports = { MCPServer };

// Run standalone
if (require.main === module) {
  const server = new MCPServer();
  server.start().catch(err => log.error('mcp-server', 'start failed', { error: err.message }));
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}
