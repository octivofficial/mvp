/**
 * Octiv Dashboard Server — Phase 6.1
 * Real-time web dashboard with SSE for agent monitoring.
 * Usage: node agent/dashboard.js (port 3000)
 */
const http = require('http');
const { Blackboard } = require('./blackboard');
const { SkillZettelkasten, TIERS } = require('./skill-zettelkasten');
const { getLogger } = require('./logger');
const log = getLogger();

const PORT = process.env.DASHBOARD_PORT || 3000;

class DashboardServer {
  constructor(port = PORT) {
    this.port = port;
    this.board = new Blackboard();
    this.server = null;
    this.sseClients = [];
    this.subscriber = null;
    this.agentState = {};
    this.skillZk = null;
  }

  async start() {
    await this.board.connect();
    this.skillZk = new SkillZettelkasten();
    await this.skillZk.init();
    this.subscriber = await this.board.createSubscriber();
    this._subscribeUpdates();

    this.server = http.createServer((req, res) => this._handleRequest(req, res));
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        log.info('dashboard', `http://localhost:${this.port}`);
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
      this.server.closeAllConnections();
      await new Promise((resolve) => this.server.close(resolve));
    }
    if (this.skillZk) await this.skillZk.shutdown();
    await this.board.disconnect();
  }

  _subscribeUpdates() {
    this._safePSub('octiv:agent:*', (data, channel) => {
      const [, , agentId, ...rest] = channel.split(':');
      const eventType = rest.join(':');
      this.agentState[agentId] = {
        ...this.agentState[agentId],
        [eventType]: data,
        lastUpdate: Date.now(),
      };
      this._broadcast({ type: eventType, agentId, data });
    });

    this._safePSub('octiv:safety:*', (data, channel) => {
      this._broadcast({ type: 'safety', channel, data });
    });

    this._safePSub('octiv:leader:*', (data, channel) => {
      this._broadcast({ type: 'leader', channel, data });
    });

    this._safePSub('octiv:zettelkasten:*', (data, channel) => {
      const [, , ...rest] = channel.split(':');
      this._broadcast({ type: 'skill', subtype: rest.join(':'), data });
    });
  }

  _safePSub(pattern, handler) {
    this.subscriber.pSubscribe(pattern, (message, channel) => {
      try { handler(JSON.parse(message), channel); } catch (e) { log.debug('dashboard', 'psub parse error', { channel, error: e.message }); }
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
    if (req.url === '/api/skills') {
      return this._handleAPISkills(req, res);
    }
    if (req.url.startsWith('/api/skills/')) {
      return this._handleAPISkillDetail(req, res);
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
    this._sendJSON(res, 200, { agents: this.agentState, timestamp: Date.now() });
  }

  _serveDashboard(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DASHBOARD_HTML);
  }

  async _handleAPISkills(req, res) {
    try {
      const notes = await this.skillZk.getAllNotes();
      const stats = SkillZettelkasten.computeStats(notes);
      const skills = Object.values(notes).map((n) => ({
        id: n.id,
        name: n.name,
        tier: n.tier,
        xp: n.xp,
        uses: n.uses,
        successRate: n.successRate,
        status: n.status,
        links: n.links.length,
      }));
      this._sendJSON(res, 200, { stats, skills, tiers: TIERS });
    } catch (err) {
      this._sendJSON(res, 500, { error: err.message });
    }
  }

  async _handleAPISkillDetail(req, res) {
    const raw = req.url.split('/api/skills/')[1] || '';
    const skillId = decodeURIComponent(raw);
    if (!skillId || skillId.includes('/')) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }
    try {
      const note = await this.skillZk.getNote(skillId);
      if (!note) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      this._sendJSON(res, 200, note);
    } catch (err) {
      this._sendJSON(res, 500, { error: err.message });
    }
  }

  _sendJSON(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
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
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; background: #161b22; padding: 4px; border-radius: 8px; }
  .tab { font-family: monospace; background: none; border: 1px solid #30363d; color: #8b949e; padding: 6px 16px; border-radius: 6px; cursor: pointer; }
  .tab.active { color: #58a6ff; border-color: #58a6ff; background: #0d1117; }
  .stats-bar { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 10px 16px; min-width: 120px; }
  .stat-card .label { color: #8b949e; font-size: 11px; }
  .stat-card .value { color: #58a6ff; font-size: 18px; font-weight: bold; }
  .tier-bar { display: flex; height: 20px; border-radius: 4px; overflow: hidden; margin-bottom: 12px; }
  .tier-seg { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #0d1117; font-weight: bold; min-width: 2px; }
  .skill-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .skill-table th { text-align: left; color: #8b949e; padding: 6px 8px; border-bottom: 1px solid #30363d; }
  .skill-table td { padding: 6px 8px; border-bottom: 1px solid #21262d; }
  .skill-table tr:hover { background: #161b22; }
  #skill-events { max-height: 200px; overflow-y: auto; font-size: 12px; }
</style>
</head>
<body>
<h1>Octiv Dashboard</h1>
<nav class="tabs">
  <button class="tab active" data-tab="agents">Agents</button>
  <button class="tab" data-tab="skills">Skill Lab</button>
</nav>
<div id="agents-panel">
  <div id="agents" class="grid"></div>
  <h2 style="color:#58a6ff;margin-top:16px">Live Events</h2>
  <div id="events"></div>
</div>
<div id="skills-panel" style="display:none">
  <div class="stats-bar" id="skill-stats"></div>
  <div class="tier-bar" id="tier-dist"></div>
  <table class="skill-table" id="skill-table">
    <thead><tr><th>Skill</th><th>Tier</th><th>XP</th><th>Uses</th><th>Success</th><th>Links</th></tr></thead>
    <tbody></tbody>
  </table>
  <h3 style="color:#58a6ff;margin-top:12px">Skill Events</h3>
  <div id="skill-events"></div>
</div>
<script>
const agentsDiv = document.getElementById('agents');
const eventsDiv = document.getElementById('events');
const skillEventsDiv = document.getElementById('skill-events');
const state = {};

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
  document.getElementById('agents-panel').style.display = tab === 'agents' ? '' : 'none';
  document.getElementById('skills-panel').style.display = tab === 'skills' ? '' : 'none';
  if (tab === 'skills') loadSkills();
}

const es = new EventSource('/events');
es.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type === 'connected') return;
  if (evt.type === 'skill') {
    addSkillEvent(evt);
    return;
  }
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

const tierColors = { Novice:'#3fb950', Apprentice:'#2ea043', Journeyman:'#1f6feb', Expert:'#8957e5', Master:'#f0883e', Grandmaster:'#d29922' };
let skillsLastLoaded = 0;

function loadSkills() {
  if (Date.now() - skillsLastLoaded < 5000) return;
  skillsLastLoaded = Date.now();
  fetch('/api/skills').then(r=>r.json()).then(d => {
    const ss = document.getElementById('skill-stats');
    const ht = d.stats.highestTier;
    ss.innerHTML = statCard('Total Skills', d.stats.totalNotes)
      + statCard('Active', d.stats.activeSkills)
      + statCard('Total XP', d.stats.totalXP)
      + statCard('Highest', ht ? ht.tier : '-');
    const td = document.getElementById('tier-dist');
    const total = Math.max(d.skills.length, 1);
    td.innerHTML = d.tiers.map(t => {
      const c = d.stats.tierDistribution[t.name] || 0;
      const pct = (c / total * 100);
      return c > 0 ? '<div class="tier-seg" style="width:' + pct + '%;background:' + (tierColors[t.name]||'#666') + '">' + t.emoji + c + '</div>' : '';
    }).join('');
    const tb = document.querySelector('#skill-table tbody');
    tb.innerHTML = d.skills.map(s =>
      '<tr><td>' + s.name + '</td><td style="color:' + (tierColors[s.tier]||'#ccc') + '">' + s.tier + '</td><td>' + s.xp + '</td><td>' + s.uses + '</td><td>' + (s.successRate * 100).toFixed(0) + '%</td><td>' + s.links + '</td></tr>'
    ).join('');
  }).catch(() => {});
}

function statCard(l, v) { return '<div class="stat-card"><div class="label">' + l + '</div><div class="value">' + v + '</div></div>'; }

function addSkillEvent(evt) {
  const div = document.createElement('div');
  div.className = 'event';
  div.textContent = new Date().toLocaleTimeString() + ' [' + (evt.subtype||'skill') + '] ' + JSON.stringify(evt.data).slice(0,120);
  skillEventsDiv.prepend(div);
  while (skillEventsDiv.children.length > 50) skillEventsDiv.lastChild.remove();
}

fetch('/api/state').then(r=>r.json()).then(d => { Object.assign(state, d.agents); renderAgents(); });
</script>
</body>
</html>`;

module.exports = { DashboardServer };

// Run standalone
if (require.main === module) {
  const dash = new DashboardServer();
  dash.start().catch(err => log.error('dashboard', 'start failed', { error: err.message }));
  process.on('SIGINT', async () => {
    await dash.stop();
    process.exit(0);
  });
}
