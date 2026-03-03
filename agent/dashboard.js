/**
 * Octiv Dashboard Server — Phase 6.1
 * Real-time web dashboard with SSE for agent monitoring.
 * Usage: node agent/dashboard.js (port 3000)
 */
const http = require('http');
const { Blackboard } = require('./blackboard');

const PORT = process.env.DASHBOARD_PORT || 3000;

class DashboardServer {
  constructor(port = PORT) {
    this.port = port;
    this.board = new Blackboard();
    this.server = null;
    this.sseClients = [];
    this.subscriber = null;
    this.agentState = {};
  }

  async start() {
    await this.board.connect();
    this.subscriber = this.board.client.duplicate();
    await this.subscriber.connect();
    this._subscribeUpdates();

    this.server = http.createServer((req, res) => this._handleRequest(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[Dashboard] http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop() {
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients = [];
    if (this.subscriber) {
      await this.subscriber.pUnsubscribe();
      await this.subscriber.disconnect();
    }
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
    }
    await this.board.disconnect();
  }

  _subscribeUpdates() {
    this.subscriber.pSubscribe('octiv:agent:*', (message, channel) => {
      try {
        const data = JSON.parse(message);
        const parts = channel.split(':');
        const agentId = parts[2];
        const eventType = parts.slice(3).join(':');

        this.agentState[agentId] = {
          ...this.agentState[agentId],
          [eventType]: data,
          lastUpdate: Date.now(),
        };

        this._broadcast({ type: eventType, agentId, data });
      } catch {}
    });

    this.subscriber.pSubscribe('octiv:safety:*', (message, channel) => {
      try {
        const data = JSON.parse(message);
        this._broadcast({ type: 'safety', channel, data });
      } catch {}
    });

    this.subscriber.pSubscribe('octiv:leader:*', (message, channel) => {
      try {
        const data = JSON.parse(message);
        this._broadcast({ type: 'leader', channel, data });
      } catch {}
    });
  }

  _broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    this.sseClients = this.sseClients.filter((client) => {
      try {
        client.write(payload);
        return true;
      } catch {
        return false;
      }
    });
  }

  _handleRequest(req, res) {
    if (req.url === '/events') {
      return this._handleSSE(req, res);
    }
    if (req.url === '/api/state') {
      return this._handleAPIState(req, res);
    }
    if (req.url === '/' || req.url === '/index.html') {
      return this._serveDashboard(req, res);
    }
    res.writeHead(404);
    res.end('Not found');
  }

  _handleSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('data: {"type":"connected"}\n\n');
    this.sseClients.push(res);
    req.on('close', () => {
      this.sseClients = this.sseClients.filter((c) => c !== res);
    });
  }

  _handleAPIState(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents: this.agentState, timestamp: Date.now() }));
  }

  _serveDashboard(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
  }

  getState() {
    return { ...this.agentState };
  }
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Octiv Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: monospace; background: #0d1117; color: #c9d1d9; padding: 16px; }
  h1 { color: #58a6ff; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }
  .card h3 { color: #58a6ff; margin-bottom: 8px; }
  .field { display: flex; justify-content: space-between; padding: 2px 0; }
  .label { color: #8b949e; }
  .value { color: #c9d1d9; }
  .ok { color: #3fb950; }
  .warn { color: #d29922; }
  .danger { color: #f85149; }
  #events { margin-top: 16px; max-height: 300px; overflow-y: auto; font-size: 12px; }
  .event { padding: 2px 0; border-bottom: 1px solid #21262d; }
</style>
</head>
<body>
<h1>Octiv Dashboard</h1>
<div id="agents" class="grid"></div>
<h2 style="color:#58a6ff;margin-top:16px">Live Events</h2>
<div id="events"></div>
<script>
const agentsDiv = document.getElementById('agents');
const eventsDiv = document.getElementById('events');
const state = {};

const es = new EventSource('/events');
es.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type === 'connected') return;
  if (evt.agentId) {
    state[evt.agentId] = { ...state[evt.agentId], [evt.type]: evt.data, lastUpdate: Date.now() };
    renderAgents();
  }
  addEvent(evt);
};

function renderAgents() {
  agentsDiv.innerHTML = Object.entries(state).map(([id, s]) => {
    const hp = s.health?.health ?? '?';
    const hpClass = hp > 10 ? 'ok' : hp > 5 ? 'warn' : 'danger';
    return '<div class="card"><h3>' + id + '</h3>'
      + field('Health', '<span class="' + hpClass + '">' + hp + '/20</span>')
      + field('Food', (s.health?.food ?? '?') + '/20')
      + field('Status', s.status?.status ?? 'unknown')
      + field('Iteration', s.react?.iteration ?? '-')
      + '</div>';
  }).join('');
}

function field(l, v) { return '<div class="field"><span class="label">' + l + '</span><span class="value">' + v + '</span></div>'; }

function addEvent(evt) {
  const div = document.createElement('div');
  div.className = 'event';
  div.textContent = new Date().toLocaleTimeString() + ' [' + (evt.agentId||evt.type) + '] ' + JSON.stringify(evt.data).slice(0,120);
  eventsDiv.prepend(div);
  while (eventsDiv.children.length > 100) eventsDiv.lastChild.remove();
}

fetch('/api/state').then(r=>r.json()).then(d => { Object.assign(state, d.agents); renderAgents(); });
</script>
</body>
</html>`;

module.exports = { DashboardServer };

// Run standalone
if (require.main === module) {
  const dash = new DashboardServer();
  dash.start().catch(console.error);
  process.on('SIGINT', async () => {
    await dash.stop();
    process.exit(0);
  });
}
