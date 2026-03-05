/**
 * Octiv Obsidian Bridge — Redis Pub/Sub -> Obsidian REST API
 *
 * Subscribes to Blackboard events and writes heartbeat .md files
 * to vault/05-Live/ via the Obsidian Local REST API.
 * Dataview (2.5s auto-refresh) reads frontmatter → Dashboard renders live.
 *
 * Pattern: mirrors discord-bot.js (Redis subscriber bridge).
 * Related: vault-sync.js handles static session-boundary updates.
 */
const https = require('https');
const { Blackboard, PREFIX } = require('./blackboard');
const { getLogger } = require('./logger');
const T = require('../config/timeouts');

const log = getLogger();

const VAULT_LIVE_BASE = 'vault/05-Live';

// ── Frontmatter Generators ───────────────────────────────────────

/**
 * Generate YAML frontmatter + body for an agent heartbeat file.
 * @param {string} agentId
 * @param {object} data - merged agent state
 * @returns {string} markdown
 */
function _generateAgentFrontmatter(agentId, data) {
  const pos = data.position || {};
  const lines = [
    '---',
    `agent_id: ${agentId}`,
    `status: ${data.status || 'unknown'}`,
    `health: ${data.health ?? 0}`,
    `food: ${data.food ?? 0}`,
    `pos_x: ${Math.round(pos.x || 0)}`,
    `pos_y: ${Math.round(pos.y || 0)}`,
    `pos_z: ${Math.round(pos.z || 0)}`,
    `task: "${data.task || ''}"`,
    `role: "${data.role || agentId.split('-')[0]}"`,
    `updated: ${new Date().toISOString()}`,
    '---',
    '',
    `# ${agentId}`,
    '',
    `> Live heartbeat — updated by obsidian-bridge.js`,
  ];
  return lines.join('\n');
}

/**
 * Generate YAML frontmatter for system vitals.
 */
function _generateSystemFrontmatter(data) {
  const lines = [
    '---',
    `redis: ${data.redis || 'unknown'}`,
    `agents_online: ${data.agents_online ?? 0}`,
    `uptime_seconds: ${data.uptime_seconds ?? 0}`,
    `bridge_status: ${data.bridge_status || 'unknown'}`,
    `consecutive_failures: ${data.consecutive_failures ?? 0}`,
    `updated: ${new Date().toISOString()}`,
    '---',
    '',
    '# System Vitals',
    '',
    '> Live heartbeat — updated every 10s by obsidian-bridge.js',
  ];
  return lines.join('\n');
}

/**
 * Generate a single event entry line for the rolling log.
 */
function _generateEventEntry(event) {
  const ts = event.ts ? new Date(event.ts).toISOString().slice(11, 19) : 'N/A';
  const agent = event.agent || event.agentId || 'system';
  const msg = event.message || event.description || event.type || '—';
  return `| ${ts} | ${event.type || '?'} | ${agent} | ${msg} |`;
}

/**
 * Generate skills snapshot frontmatter.
 */
function _generateSkillsFrontmatter(skills) {
  const lines = [
    '---',
    `skill_count: ${skills.length}`,
    `updated: ${new Date().toISOString()}`,
    '---',
    '',
    '# Skills Snapshot',
    '',
    '| Skill | Tier | XP |',
    '|-------|------|-----|',
  ];
  for (const s of skills) {
    lines.push(`| ${s.name} | ${s.tier || '?'} | ${s.xp ?? 0} |`);
  }
  return lines.join('\n');
}

/**
 * Generate GoT trace frontmatter.
 */
function _generateGoTFrontmatter(data) {
  const lines = [
    '---',
    `synergies: ${data.synergies ?? 0}`,
    `gaps: ${data.gaps ?? 0}`,
    `updated: ${new Date().toISOString()}`,
    '---',
    '',
    '# GoT Reasoning Trace',
    '',
    `**Q:** ${data.question || 'N/A'}`,
    '',
    `**A:** ${data.answer || 'N/A'}`,
  ];
  return lines.join('\n');
}

// ── ObsidianBridge ───────────────────────────────────────────────

class ObsidianBridge {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || process.env.OBSIDIAN_API_KEY || '';
    this.port = opts.port || parseInt(process.env.OBSIDIAN_API_PORT) || 27124;
    this.redisUrl = opts.redisUrl || process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';
    this._apiTimeout = T.OBSIDIAN_API_TIMEOUT_MS;

    // State
    this.board = null;
    this.subscriber = null;
    this._running = false;
    this._startTime = Date.now();
    this._consecutiveFailures = 0;

    // Throttle: per-agent debounce timers + pending data
    this._agentTimers = new Map();
    this._agentPending = new Map();

    // Event buffer
    this._eventBuffer = [];
    this._eventFlushTimer = null;

    // Heartbeat timer
    this._heartbeatTimer = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start() {
    const board = this._createBlackboard();
    this.board = board;
    await board.connect();
    this.subscriber = await board.createSubscriber();

    this._subscribeBlackboard();
    this._startHeartbeat();
    this._startEventFlush();
    this._running = true;
    this._startTime = Date.now();

    log.info('obsidian-bridge', 'started', { port: this.port });
  }

  async stop() {
    this._running = false;

    // Flush pending writes
    await this._flushPendingAgents();
    await this._flushEvents();

    this._clearTimers();

    if (this.subscriber) {
      try { await this.subscriber.disconnect(); } catch { /* ignore */ }
    }
    if (this.board) {
      try { await this.board.disconnect(); } catch { /* ignore */ }
    }

    log.info('obsidian-bridge', 'stopped');
  }

  _createBlackboard() {
    return new Blackboard(this.redisUrl);
  }

  _clearTimers() {
    for (const timer of this._agentTimers.values()) {
      clearTimeout(timer);
    }
    this._agentTimers.clear();
    if (this._eventFlushTimer) {
      clearInterval(this._eventFlushTimer);
      this._eventFlushTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ── Blackboard Subscriptions ───────────────────────────────────

  _subscribeBlackboard() {
    // Agent status -> throttled file write
    this.subscriber.pSubscribe(PREFIX + 'agent:*:status', (message, channel) => {
      try {
        const data = JSON.parse(message);
        const agentId = data.agentId || _extractAgentId(channel);
        this._throttledAgentWrite(agentId, { ...data, status: data.status || 'active' });
      } catch (err) {
        log.error('obsidian-bridge', 'status parse error', { error: err.message });
      }
    });

    // Agent health -> throttled file write
    this.subscriber.pSubscribe(PREFIX + 'agent:*:health', (message, channel) => {
      try {
        const data = JSON.parse(message);
        const agentId = data.agentId || _extractAgentId(channel);
        this._throttledAgentWrite(agentId, data);
      } catch (err) {
        log.error('obsidian-bridge', 'health parse error', { error: err.message });
      }
    });

    // Agent inventory -> throttled file write
    this.subscriber.pSubscribe(PREFIX + 'agent:*:inventory', (message, channel) => {
      try {
        const data = JSON.parse(message);
        const agentId = data.agentId || _extractAgentId(channel);
        this._throttledAgentWrite(agentId, { inventory: data.items });
      } catch (err) {
        log.error('obsidian-bridge', 'inventory parse error', { error: err.message });
      }
    });

    // Agent react -> throttled file write
    this.subscriber.pSubscribe(PREFIX + 'agent:*:react', (message, channel) => {
      try {
        const data = JSON.parse(message);
        const agentId = data.agentId || _extractAgentId(channel);
        this._throttledAgentWrite(agentId, { task: data.action || 'react' });
      } catch (err) {
        log.error('obsidian-bridge', 'react parse error', { error: err.message });
      }
    });

    // Agent chat -> event buffer
    this.subscriber.pSubscribe(PREFIX + 'agent:*:chat', (message, channel) => {
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._appendEvent({ type: 'chat', agent: data.agentId, message: data.message || data.text, ts: data.ts });
      } catch (err) {
        log.error('obsidian-bridge', 'chat parse error', { error: err.message });
      }
    });

    // Agent confess -> event buffer
    this.subscriber.pSubscribe(PREFIX + 'agent:*:confess', (message, channel) => {
      try {
        const data = JSON.parse(message);
        data.agentId = data.agentId || _extractAgentId(channel);
        this._appendEvent({ type: 'confess', agent: data.agentId, message: data.message || data.text, ts: data.ts });
      } catch (err) {
        log.error('obsidian-bridge', 'confess parse error', { error: err.message });
      }
    });

    // Safety threat -> event buffer
    this.subscriber.subscribe(PREFIX + 'safety:threat', (message) => {
      try {
        const data = JSON.parse(message);
        this._appendEvent({
          type: 'threat',
          agent: data.agentId || 'safety',
          message: data.threatType || data.threat?.type || 'unknown',
          ts: data.ts,
        });
      } catch (err) {
        log.error('obsidian-bridge', 'threat parse error', { error: err.message });
      }
    });

    // Leader reflexion -> event buffer
    this.subscriber.subscribe(PREFIX + 'leader:reflexion', (message) => {
      try {
        const data = JSON.parse(message);
        this._appendEvent({
          type: 'reflexion',
          agent: 'leader',
          message: data.description || data.message || 'Group Reflexion',
          ts: data.ts,
        });
      } catch (err) {
        log.error('obsidian-bridge', 'reflexion parse error', { error: err.message });
      }
    });

    // GoT reasoning complete -> immediate write
    this.subscriber.subscribe(PREFIX + 'got:reasoning-complete', (message) => {
      try {
        const data = JSON.parse(message);
        this._writeGoTTrace(data);
      } catch (err) {
        log.error('obsidian-bridge', 'got parse error', { error: err.message });
      }
    });

    // Zettelkasten events -> immediate skills snapshot
    this.subscriber.pSubscribe(PREFIX + 'zettelkasten:*', (message) => {
      try {
        const data = JSON.parse(message);
        this._writeSkillsSnapshot(data);
      } catch (err) {
        log.error('obsidian-bridge', 'zettelkasten parse error', { error: err.message });
      }
    });

    log.info('obsidian-bridge', 'blackboard subscriptions active');
  }

  // ── Throttled Agent Writes ─────────────────────────────────────

  _throttledAgentWrite(agentId, data) {
    // Merge with pending data
    const existing = this._agentPending.get(agentId) || {};
    this._agentPending.set(agentId, { ...existing, ...data });

    // Reset debounce timer
    if (this._agentTimers.has(agentId)) {
      clearTimeout(this._agentTimers.get(agentId));
    }

    const timer = setTimeout(async () => {
      this._agentTimers.delete(agentId);
      const pending = this._agentPending.get(agentId);
      if (pending) {
        this._agentPending.delete(agentId);
        const md = _generateAgentFrontmatter(agentId, pending);
        await this._obsidianPut(`${VAULT_LIVE_BASE}/agents/${agentId}.md`, md);
      }
    }, T.OBSIDIAN_AGENT_DEBOUNCE_MS);

    this._agentTimers.set(agentId, timer);
  }

  async _flushPendingAgents() {
    const promises = [];
    for (const [agentId, data] of this._agentPending.entries()) {
      const md = _generateAgentFrontmatter(agentId, data);
      promises.push(this._obsidianPut(`${VAULT_LIVE_BASE}/agents/${agentId}.md`, md));
    }
    this._agentPending.clear();
    for (const timer of this._agentTimers.values()) {
      clearTimeout(timer);
    }
    this._agentTimers.clear();
    await Promise.allSettled(promises);
  }

  // ── Event Buffer ───────────────────────────────────────────────

  _appendEvent(event) {
    this._eventBuffer.push({ ...event, ts: event.ts || Date.now() });
    if (this._eventBuffer.length > T.OBSIDIAN_MAX_EVENTS) {
      this._eventBuffer = this._eventBuffer.slice(-T.OBSIDIAN_MAX_EVENTS);
    }
  }

  _startEventFlush() {
    this._eventFlushTimer = setInterval(async () => {
      await this._flushEvents();
    }, T.OBSIDIAN_EVENT_FLUSH_MS);
  }

  async _flushEvents() {
    const md = this._buildEventsMarkdown();
    await this._obsidianPut(`${VAULT_LIVE_BASE}/events.md`, md);
  }

  _buildEventsMarkdown() {
    const lines = [
      '---',
      `event_count: ${this._eventBuffer.length}`,
      `updated: ${new Date().toISOString()}`,
      '---',
      '',
      '# Live Events',
      '',
      '| Time | Type | Agent | Message |',
      '|------|------|-------|---------|',
    ];
    // Show newest first
    for (let i = this._eventBuffer.length - 1; i >= 0; i--) {
      lines.push(_generateEventEntry(this._eventBuffer[i]));
    }
    return lines.join('\n');
  }

  // ── Immediate Writes ───────────────────────────────────────────

  async _writeGoTTrace(data) {
    const md = _generateGoTFrontmatter(data);
    await this._obsidianPut(`${VAULT_LIVE_BASE}/got-traces.md`, md);
  }

  async _writeSkillsSnapshot(data) {
    const skills = data.skills || (data.name ? [data] : []);
    const md = _generateSkillsFrontmatter(skills);
    await this._obsidianPut(`${VAULT_LIVE_BASE}/skills-live.md`, md);
  }

  // ── System Heartbeat ───────────────────────────────────────────

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      this._writeSystemHeartbeat();
    }, T.OBSIDIAN_HEARTBEAT_MS);
  }

  async _writeSystemHeartbeat() {
    const data = this._buildHeartbeatData();
    const md = _generateSystemFrontmatter(data);
    await this._obsidianPut(`${VAULT_LIVE_BASE}/system.md`, md);
  }

  _buildHeartbeatData() {
    return {
      redis: this.board ? 'connected' : 'disconnected',
      agents_online: this._agentPending.size + this._agentTimers.size,
      uptime_seconds: Math.round((Date.now() - this._startTime) / 1000),
      bridge_status: 'running',
      consecutive_failures: this._consecutiveFailures,
    };
  }

  // ── Obsidian REST API ──────────────────────────────────────────

  _buildUrl(path) {
    return `https://127.0.0.1:${this.port}/${path}`;
  }

  _buildHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'text/markdown',
    };
  }

  async _obsidianPut(filePath, content) {
    return new Promise((resolve) => {
      const url = new URL(this._buildUrl(filePath));
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'PUT',
        headers: this._buildHeaders(),
        rejectUnauthorized: false, // localhost self-signed cert
        timeout: this._apiTimeout,
      };

      const req = https.request(opts, (res) => {
        res.on('data', () => {}); // drain response
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            this._onApiSuccess();
          } else {
            this._onApiFailure(`HTTP ${res.statusCode}`);
          }
          resolve();
        });
      });

      req.on('error', (err) => {
        this._onApiFailure(err.message);
        resolve(); // never throw
      });

      req.on('timeout', () => {
        req.destroy();
        this._onApiFailure('timeout');
        resolve();
      });

      req.write(content);
      req.end();
    });
  }

  _onApiSuccess() {
    if (this._consecutiveFailures > 0) {
      log.info('obsidian-bridge', 'API recovered');
    }
    this._consecutiveFailures = 0;
  }

  _onApiFailure(reason) {
    this._consecutiveFailures++;
    if (this._consecutiveFailures <= 3 || this._consecutiveFailures % 10 === 0) {
      log.warn('obsidian-bridge', 'API write failed', {
        reason,
        failures: this._consecutiveFailures,
      });
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function _extractAgentId(channel) {
  const parts = (channel || '').split(':');
  const agentIdx = parts.indexOf('agent');
  return (agentIdx >= 0 && parts[agentIdx + 1]) ? parts[agentIdx + 1] : 'unknown';
}

// ── Exports ──────────────────────────────────────────────────────

module.exports = {
  ObsidianBridge,
  _generateAgentFrontmatter,
  _generateSystemFrontmatter,
  _generateEventEntry,
  _generateSkillsFrontmatter,
  _generateGoTFrontmatter,
  _extractAgentId,
};

// ── CLI Entry Point ──────────────────────────────────────────────

if (require.main === module) {
  const bridge = new ObsidianBridge();
  bridge.start().catch((err) => {
    log.error('obsidian-bridge', 'failed to start', { error: err.message });
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await bridge.stop();
    process.exit(0);
  });
}
