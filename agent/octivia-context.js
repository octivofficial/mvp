// agent/octivia-context.js — Octivia's Shared Memory Layer
//
// Aggregates all project state so Octivia always knows:
//   - What's been built (git log, MEMORY.md)
//   - Who's running (Redis agents registry)
//   - What ideas have been captured (vault/00-Vibes/)
//
// Cached at 60s intervals. Gracefully degrades if any source is unavailable.
// Injected into every LLM prompt so the gap between "idea" and "reality" is visible.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');

const log = getLogger();

const VAULT_DIR = path.join(__dirname, '..', 'vault');
const MEMORY_PATH = path.join(VAULT_DIR, 'MEMORY.md');
const VIBES_DIR = path.join(VAULT_DIR, '00-Vibes');
const CACHE_TTL_MS = 60_000; // 60s

class OctiviaContext {
  constructor(board = null) {
    this.board = board;
    this._cache = null;
    this._cacheTs = 0;
  }

  /**
   * Gather all context sources. Returns cached data if < 60s old.
   * @returns {{ memory, recentCommits, agents, previousVibes, ts }}
   */
  async gather() {
    const now = Date.now();
    if (this._cache && now - this._cacheTs < CACHE_TTL_MS) return this._cache;

    const [memory, recentCommits, agents, previousVibes] = await Promise.all([
      this._readMemory(),
      this._gitLog(),
      this._getAgents(),
      this._getPreviousVibes(),
    ]);

    this._cache = { memory, recentCommits, agents, previousVibes, ts: now };
    this._cacheTs = now;
    log.debug('octivia-context', 'Context refreshed', {
      agents: Object.keys(agents).length,
      vibes: (previousVibes.match(/^-/gm) || []).length,
    });
    return this._cache;
  }

  /** Format context for LLM injection */
  format(ctx) {
    if (!ctx) return '';
    const parts = [];

    if (ctx.recentCommits) {
      parts.push(`Recent commits (last 8):\n${ctx.recentCommits}`);
    }
    const agentKeys = Object.keys(ctx.agents || {});
    if (agentKeys.length > 0) {
      parts.push(`Active agents: ${agentKeys.join(', ')}`);
    }
    if (ctx.previousVibes) {
      parts.push(`Previous vibes captured:\n${ctx.previousVibes}`);
    }
    if (ctx.memory) {
      // Include Phase Status and Architecture overview only
      const phaseMatch = ctx.memory.match(/## Phase Status[\s\S]{0,400}/);
      const archMatch = ctx.memory.match(/## Architecture[\s\S]{0,300}/);
      if (phaseMatch) parts.push(`Phase Status:\n${phaseMatch[0].slice(0, 300)}`);
      if (archMatch) parts.push(`Architecture:\n${archMatch[0].slice(0, 200)}`);
    }

    return parts.join('\n\n') || 'System context unavailable.';
  }

  // ── Internal sources ──────────────────────────────────────

  async _readMemory() {
    try {
      const raw = await fs.promises.readFile(MEMORY_PATH, 'utf8').catch(() => '');
      return raw.slice(0, 3000);
    } catch { return ''; }
  }

  _gitLog() {
    try {
      const out = execSync('git log --oneline -8 2>/dev/null', {
        cwd: path.join(__dirname, '..'),
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.toString().trim();
    } catch { return ''; }
  }

  async _getAgents() {
    if (!this.board) return {};
    try {
      const hash = await this.board.getHash('agents:registry');
      return hash || {};
    } catch { return {}; }
  }

  async _getPreviousVibes() {
    try {
      const files = await fs.promises.readdir(VIBES_DIR).catch(() => []);
      const mdFiles = files
        .filter(f => f.endsWith('.md') && f !== 'README.md')
        .sort()
        .slice(-5);
      const snippets = [];
      for (const f of mdFiles) {
        const raw = await fs.promises.readFile(path.join(VIBES_DIR, f), 'utf8').catch(() => '');
        const title = raw.match(/^# (.+)/m)?.[1] || f.replace('.md', '');
        const intent = raw.match(/\*\*Intent\*\*: (.+)/)?.[1] || '';
        snippets.push(`- ${f.slice(0, 10)}: "${title}"${intent ? ` → ${intent}` : ''}`);
      }
      return snippets.join('\n');
    } catch { return ''; }
  }
}

module.exports = OctiviaContext;
