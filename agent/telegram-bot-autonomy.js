// agent/telegram-bot-autonomy.js — Octivia Autonomy Module
//
// Event-driven (not interval) autonomy for group chat:
//  - Auto-sync to vault after N messages (silent, no Telegram reply)
//  - Pattern detection via LLM after M messages (digest → vault)
//  - Context recap on @mention when messages accumulated
//
// Triggered from telegram-bot.js _recordGroupMessage() hook.
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');

const log = getLogger();

const VAULT_CHAT_DIR = path.join(__dirname, '..', 'vault', '02-GroupChat');
const VAULT_DIGEST_DIR = path.join(VAULT_CHAT_DIR, 'digests');

const {
  OCTIVIA_AUTO_SYNC_THRESHOLD,
  OCTIVIA_PATTERN_DETECT_THRESHOLD,
  OCTIVIA_CONTEXT_RECAP_THRESHOLD,
} = require('../config/timeouts');

class OctiviaAutonomy {
  /**
   * @param {object} params
   * @param {object} params.board - Blackboard instance
   * @param {object} [params.reflexion] - LLM interface (callLLM)
   * @param {object} [params.context] - OctiviaContext (gather/format)
   * @param {object} [params.options] - threshold overrides
   */
  constructor({ board, reflexion = null, context = null, options = {} } = {}) {
    this.board = board;
    this.reflexion = reflexion;
    this.context = context;

    // Thresholds (configurable via options or timeouts.js)
    this._syncThreshold = options.autoSyncThreshold || OCTIVIA_AUTO_SYNC_THRESHOLD;
    this._patternThreshold = options.patternDetectThreshold || OCTIVIA_PATTERN_DETECT_THRESHOLD;
    this._recapThreshold = options.contextRecapThreshold ?? OCTIVIA_CONTEXT_RECAP_THRESHOLD;

    // Per-chatId state
    this._counters = new Map();   // chatId → { sinceSync, sinceSummary }
    this._busy = new Set();       // chatId — prevents concurrent processing
    this._lastSync = new Map();   // chatId → timestamp
  }

  /**
   * Hook called after every group message is recorded.
   * Checks counters and triggers auto-sync / pattern detection.
   * @param {number} chatId
   * @param {object} session - { stage, notes[] }
   */
  async onMessage(chatId, session) {
    const counter = this._getCounter(chatId);
    counter.sinceSync++;
    counter.sinceSummary++;

    // Auto-sync at threshold
    if (counter.sinceSync >= this._syncThreshold && !this._busy.has(chatId)) {
      this._busy.add(chatId);
      try {
        await this._autoSync(chatId, session);
        counter.sinceSync = 0;
        this._lastSync.set(chatId, Date.now());
      } catch (e) {
        log.debug('autonomy', 'auto-sync error', { chatId, error: e.message });
      } finally {
        this._busy.delete(chatId);
      }
    }

    // Pattern detection at threshold (requires LLM + busy guard)
    const busyKey = `detect:${chatId}`;
    if (counter.sinceSummary >= this._patternThreshold && this.reflexion && !this._busy.has(busyKey)) {
      this._busy.add(busyKey);
      try {
        await this._detectPatterns(chatId, session);
        counter.sinceSummary = 0;
      } catch (e) {
        log.debug('autonomy', 'pattern detection error', { chatId, error: e.message });
      } finally {
        this._busy.delete(busyKey);
      }
    }
  }

  /**
   * Returns brief context string if enough messages accumulated since last summary.
   * Called from @mention handler to enrich response.
   * @param {number} chatId
   * @param {object} session
   * @returns {string|null}
   */
  getContextRecap(chatId, session) {
    const counter = this._getCounter(chatId);
    if (counter.sinceSummary < this._recapThreshold) return null;

    const notes = Array.isArray(session?.notes) ? session.notes : [];
    if (notes.length === 0) return null;

    // Build brief recap from last 10 messages
    const recent = notes.slice(-10);
    const contributors = [...new Set(recent.map(n => n.author))];
    const topics = recent.map(n => n.text?.slice(0, 30)).filter(Boolean).slice(-5);

    const recap = `${recent.length} recent msgs from ${contributors.join(', ')}. Topics: ${topics.join('; ')}`;
    return recap.slice(0, 200);
  }

  /**
   * Silent vault sync — writes session notes to markdown file.
   * Publishes Blackboard events for downstream consumers.
   * @param {number} chatId
   * @param {object} session
   */
  async _autoSync(chatId, session) {
    const notes = Array.isArray(session?.notes) ? session.notes : [];
    if (notes.length === 0) return;

    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 16).replace(':', '');

    try {
      await fs.promises.mkdir(VAULT_CHAT_DIR, { recursive: true });
    } catch (e) {
      log.debug('autonomy', 'mkdir error', { error: e.message });
    }

    const filename = `${date}-${time}-auto-sync.md`;
    const filepath = path.join(VAULT_CHAT_DIR, filename);

    // Build markdown content
    const sections = [
      '---',
      'type: auto-sync',
      `date: ${date}`,
      `message-count: ${notes.length}`,
      `chat-id: ${chatId}`,
      '---', '',
      `# Auto-Sync — ${date} ${time}`, '',
      `> ${notes.length} messages (auto-synced)`, '',
      '## Messages\n',
    ];

    for (const note of notes.slice(-50)) {
      const t = new Date(note.ts).toISOString().slice(11, 16);
      sections.push(`- **${t}** [${note.author}]: ${note.text}`);
    }

    try {
      await fs.promises.writeFile(filepath, sections.join('\n'), 'utf8');
    } catch (e) {
      log.debug('autonomy', 'auto-sync write error', { error: e.message });
    }

    log.info('autonomy', `Auto-sync: ${filename} (${notes.length} msgs)`);

    // Publish Blackboard events
    try {
      await this.board.publish('octivia:auto-sync', {
        chatId, date, messageCount: notes.length,
        filepath, timestamp: Date.now(),
      });
      // Chain: notify NotebookLM to upload
      await this.board.publish('notebook:task', {
        action: 'upload_source', path: filepath,
      });
    } catch (e) {
      log.debug('autonomy', 'auto-sync publish error', { error: e.message });
    }
  }

  /**
   * LLM-powered pattern detection on recent messages.
   * Writes digest to vault/02-GroupChat/digests/.
   * @param {number} chatId
   * @param {object} session
   */
  async _detectPatterns(chatId, session) {
    const notes = Array.isArray(session?.notes) ? session.notes : [];
    if (notes.length === 0) return;

    const recent = notes.slice(-20);
    const messageBlock = recent.map(n =>
      `[${n.author}]: ${n.text}`
    ).join('\n');

    let analysis;
    try {
      analysis = await this.reflexion.callLLM(
        `Analyze these group chat messages. Identify:\n` +
        `1. Recurring themes (2-3 bullet points)\n` +
        `2. Key decisions made\n` +
        `3. Action items (if any)\n\n` +
        `Messages:\n${messageBlock}\n\n` +
        `Respond in concise bullet points.`,
        'normal'
      );
    } catch (e) {
      log.debug('autonomy', 'pattern detection LLM error', { error: e.message });
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 16).replace(':', '');

    try {
      await fs.promises.mkdir(VAULT_DIGEST_DIR, { recursive: true });
    } catch (e) {
      log.debug('autonomy', 'digest mkdir error', { error: e.message });
    }

    const filename = `${date}-${time}-digest.md`;
    const filepath = path.join(VAULT_DIGEST_DIR, filename);

    const content = [
      '---',
      'type: digest',
      `date: ${date}`,
      `messages-analyzed: ${recent.length}`,
      `chat-id: ${chatId}`,
      '---', '',
      `# Conversation Digest — ${date} ${time}`, '',
      analysis || 'No patterns detected.',
    ].join('\n');

    try {
      await fs.promises.writeFile(filepath, content, 'utf8');
    } catch (e) {
      log.debug('autonomy', 'digest write error', { error: e.message });
    }

    log.info('autonomy', `Digest: ${filename} (${recent.length} msgs analyzed)`);

    try {
      await this.board.publish('octivia:digest', {
        chatId, date, messagesAnalyzed: recent.length,
        filepath, timestamp: Date.now(),
      });
    } catch (e) {
      log.debug('autonomy', 'digest publish error', { error: e.message });
    }
  }

  /**
   * Lazy-init counter for a chatId.
   * @param {number} chatId
   * @returns {{ sinceSync: number, sinceSummary: number }}
   */
  _getCounter(chatId) {
    if (!this._counters.has(chatId)) {
      this._counters.set(chatId, { sinceSync: 0, sinceSummary: 0 });
    }
    return this._counters.get(chatId);
  }

  /**
   * Prune stale entries from Maps (chatIds inactive for > maxAge).
   * Call periodically to prevent unbounded memory growth.
   * @param {number} [maxAgeMs=86400000] - Max age in ms (default 24h)
   */
  pruneStale(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [chatId, ts] of this._lastSync) {
      if (now - ts > maxAgeMs) {
        this._lastSync.delete(chatId);
        this._counters.delete(chatId);
      }
    }
    // Prune counters that never synced (no lastSync entry) if Maps grow large
    if (this._counters.size > 1000) {
      const syncedIds = new Set(this._lastSync.keys());
      for (const chatId of this._counters.keys()) {
        if (!syncedIds.has(chatId)) this._counters.delete(chatId);
      }
    }
  }

  /** Cleanup all internal state */
  destroy() {
    this._counters.clear();
    this._busy.clear();
    this._lastSync.clear();
  }
}

module.exports = OctiviaAutonomy;
