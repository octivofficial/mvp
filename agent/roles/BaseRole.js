/**
 * Octiv Base Role — Phase 3.5 + DRY Refactoring
 * Abstract base for specialized agent roles.
 * Subclasses implement execute() with role-specific behavior.
 * Common methods extracted from MinerAgent/FarmerAgent for reuse.
 */
const { Blackboard } = require('../blackboard');
const { getLogger } = require('../logger');
const log = getLogger();

// Lazy-loaded navigation to avoid loading mineflayer-pathfinder at require time
let _nav = null;
function _getNav() {
  if (!_nav) _nav = require('../builder-navigation');
  return _nav;
}
function _setNav(m) { _nav = m; }

class BaseRole {
  constructor(config = {}) {
    this.id = config.id || 'agent-01';
    this.role = config.role || 'base';
    this.board = new Blackboard();
    this.status = 'idle';
    this._cachedMovements = null;
    this.inventoryThreshold = config.inventoryThreshold ?? Infinity;
    this.quotaKey = config.quotaKey ?? null;
    this.activityName = config.activityName ?? this.role;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 120000;
    this.navTimeoutMs = config.navTimeoutMs ?? 15000;
    this.totalCount = 0;
    this.idolMetrics = null; // optional IdolMetrics instance
  }

  async init() {
    await this.board.connect();
    await this.board.setHashField('agents:registry', this.id, {
      role: this.role, status: 'active', registeredAt: Date.now(),
    });
    log.info(this.id, `${this.role} initialized`);
  }

  async execute() {
    throw new Error('Subclass must implement execute()');
  }

  async reportStatus(status) {
    this.status = status;
    await this.board.publish(`agent:${this.id}:status`, { author: this.id, role: this.role, status });
  }

  async shutdown() {
    await this.board.deleteHashField('agents:registry', this.id);
    await this.board.disconnect();
  }

  // ── Common Methods (extracted from MinerAgent/FarmerAgent) ─────────

  async _safeReport(status) {
    try { await this.reportStatus(status); } catch (_) { /* Redis down */ }
  }

  _countItems(bot) {
    return bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  }

  isInventoryFull(bot) {
    return this._countItems(bot) >= this.inventoryThreshold;
  }

  getInventorySpace(bot) {
    return this.inventoryThreshold - this._countItems(bot);
  }

  async navigateTo(bot, pos, chatType, timeoutMs) {
    try {
      this.chat?.chat('navigating', {
        type: chatType, x: pos.x, y: pos.y, z: pos.z,
      })?.catch(() => {});

      const nav = _getNav();
      this._cachedMovements = nav.setupPathfinder(bot, this._cachedMovements);
      const goal = {
        x: pos.x, y: pos.y, z: pos.z, rangeSq: 1,
        isEnd: (node) => {
          const dx = node.x - pos.x;
          const dy = node.y - pos.y;
          const dz = node.z - pos.z;
          return dx * dx + dy * dy + dz * dz <= 4;
        },
        hasChanged: () => false,
      };
      await nav.goto(bot, goal, timeoutMs ?? this.navTimeoutMs);
      return { success: true };
    } catch (err) {
      const reason = err.message.includes('timeout') ? 'nav_timeout' : 'nav_error';
      return { success: false, reason };
    }
  }

  async checkQuota() {
    if (!this.quotaKey) return { hasQuota: true };
    try {
      const quota = await this.board.getConfig(this.quotaKey);
      if (!quota) return { hasQuota: true };
      return {
        hasQuota: this.totalCount < (quota.target ?? Infinity),
        target: quota.target,
        progress: this.totalCount,
      };
    } catch (_) {
      return { hasQuota: true };
    }
  }

  async reportActivityComplete(summary) {
    try {
      await this.board.publish(`agent:${this.id}:${this.activityName}:complete`, {
        author: this.id, ...summary, timestamp: Date.now(),
      });
      // Emit idol stats if metrics enabled
      if (this.idolMetrics) {
        this.idolMetrics.addXP(this.activityName);
        await this.board.publish(`agent:${this.id}:idol-stats`, {
          author: this.id, ...this.idolMetrics.getStats(),
        });
      }
    } catch (_) { /* Redis down */ }
  }

  async executeSession(bot) {
    const startTime = Date.now();
    let actionCount = 0;

    while (Date.now() - startTime < this.sessionTimeoutMs) {
      const quota = await this.checkQuota();
      if (!quota.hasQuota) break;

      if (this.isInventoryFull(bot)) {
        this.chat?.chat('inventory_full', { total: this._countItems(bot) })?.catch(() => {});
        break;
      }

      const result = await this.execute(bot);
      if (!result.success) break;
      actionCount++;
    }

    const summary = this._buildSessionSummary(actionCount);
    summary.duration = Date.now() - startTime;
    await this.reportActivityComplete(summary);
    return summary;
  }

  _buildSessionSummary(count) {
    return { actionCount: count, inventory: this.getInventory?.() ?? {} };
  }
}

module.exports = { BaseRole, _setNav };
