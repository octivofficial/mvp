/**
 * Octiv MCP Tool Server — JSON-RPC 2.0 endpoint
 * Phase 2.5: Tools for external LLM/agent control
 * Usage: node agent/mcp-server.js (port 3001)
 */
const http = require('http');
const { Blackboard } = require('./blackboard');

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
    };
  }

  async start() {
    await this.board.connect();
    // 3.6: Blackboard → MCP sync subscriber
    this.subscriber = this.board.client.duplicate();
    await this.subscriber.connect();
    this._startSync();
    this.server = http.createServer((req, res) => this._handleRequest(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[MCP] Server listening on port ${this.port}`);
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
      } catch {}
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

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
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

  // Tool: Get team/agent status from Blackboard
  async _getStatus(params) {
    const agentId = params.agentId;
    if (agentId) {
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
    if (!agentId || x == null || y == null || z == null) {
      throw new Error('Required: agentId, x, y, z');
    }
    await this.board.publish(`command:${agentId}:moveTo`, { x, y, z });
    return { agentId, command: 'moveTo', target: { x, y, z }, status: 'dispatched' };
  }

  // Tool: Command agent to chop nearest tree
  async _chopTree(params) {
    const { agentId } = params;
    if (!agentId) throw new Error('Required: agentId');
    await this.board.publish(`command:${agentId}:chopTree`, { action: 'chopTree' });
    return { agentId, command: 'chopTree', status: 'dispatched' };
  }

  // 4.7: Set LLM config via MCP → persists to Redis
  async _setLLMConfig(params) {
    const { model, temperature, maxTokens } = params;
    const updates = {};
    if (model) updates.model = model;
    if (temperature != null) updates.temperature = temperature;
    if (maxTokens != null) updates.maxTokens = maxTokens;

    const current = await this.board.client.get('octiv:config:llm');
    const config = current ? JSON.parse(current) : {};
    Object.assign(config, updates);
    await this.board.client.set('octiv:config:llm', JSON.stringify(config));
    await this.board.publish('config:llm:updated', config);
    return { config, status: 'updated' };
  }

  // 4.7: Get current LLM config
  async _getLLMConfig() {
    const raw = await this.board.client.get('octiv:config:llm');
    return { config: raw ? JSON.parse(raw) : {} };
  }

  // Tool: Get agent inventory
  async _inventory(params) {
    const { agentId } = params;
    if (!agentId) throw new Error('Required: agentId');
    const inv = await this.board.get(`agent:${agentId}:inventory`);
    return { agentId, inventory: inv || {} };
  }
}

module.exports = { MCPServer };

// Run standalone
if (require.main === module) {
  const server = new MCPServer();
  server.start().catch(console.error);
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}
