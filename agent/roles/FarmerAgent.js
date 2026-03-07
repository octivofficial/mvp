/**
 * Octiv Farmer Role — Phase 7.2 Agent Expansion
 * Specialized farming agent: finds mature crops, harvests, replants.
 * Reports progress via Blackboard and chats about harvests.
 */
const { BaseRole } = require('./BaseRole');
const { AgentChat } = require('../agent-chat');
const T = require('../../config/timeouts');

// Lazy-loaded navigation to avoid loading mineflayer-pathfinder at require time
let _nav = null;
function getNav() {
  if (!_nav) _nav = require('../builder-navigation');
  return _nav;
}

// Crop definitions with harvest maturity (metadata value at full growth)
const CROP_TYPES = [
  { name: 'wheat', seed: 'wheat_seeds', maxAge: 7 },
  { name: 'carrots', seed: 'carrot', maxAge: 7 },
  { name: 'potatoes', seed: 'potato', maxAge: 7 },
  { name: 'beetroots', seed: 'beetroot_seeds', maxAge: 3 },
];

class FarmerAgent extends BaseRole {
  constructor(config = {}) {
    super({ ...config, role: 'farmer' });
    this.searchRadius = config.searchRadius || 64;
    this.harvested = {};     // { wheat: 5, carrots: 2, ... }
    this.totalHarvested = 0;
    this.chat = new AgentChat(this.board, this.id, 'farmer');
    this._cachedMovements = null;
  }

  async execute(bot) {
    await this._safeReport('farming');

    // 1. Find mature crops
    const cropInfo = this.findMatureCrops(bot);
    if (!cropInfo) {
      await this._safeReport('searching');
      return { success: false, reason: 'no_crops_found', harvested: 0 };
    }

    // 2. Navigate to crop
    const navResult = await this.navigateToFarm(bot, cropInfo.position);
    if (!navResult.success) {
      return { success: false, reason: navResult.reason, harvested: 0 };
    }

    // 3. Get block
    const block = bot.blockAt(cropInfo.position);
    if (!block) {
      return { success: false, reason: 'block_disappeared', harvested: 0 };
    }

    // 3. Harvest (dig the crop)
    const cropType = cropInfo.type;
    try {
      await bot.dig(block);
    } catch (err) {
      return { success: false, error: err.message, harvested: 0 };
    }

    // 4. Track harvest
    this.harvested[cropType] = (this.harvested[cropType] || 0) + 1;
    this.totalHarvested++;

    // 5. Try to replant
    await this.replant(bot, block, cropType).catch(() => {});

    // 6. Chat about it
    this.chat.chat('crop_harvested', {
      type: cropType, total: this.totalHarvested,
      x: cropInfo.position.x, z: cropInfo.position.z,
    }).catch(() => {});

    // Confess on milestone
    if (this.totalHarvested > 0 && this.totalHarvested % 10 === 0) {
      this.chat.confess('farming_milestone', {
        total: this.totalHarvested, inventory: { ...this.harvested },
      }).catch(() => {});
    }

    // 7. Publish to Blackboard
    try {
      await this.board.publish(`agent:${this.id}:farming`, {
        author: this.id, crop: cropType,
        position: cropInfo.position, harvested: this.totalHarvested,
      });
    } catch (_) { /* Redis down — harvest still counts */ }

    return {
      success: true,
      crop: cropType,
      harvested: this.totalHarvested,
      position: cropInfo.position,
    };
  }

  /**
   * Find the nearest mature crop ready for harvest.
   * Checks all crop types and returns the first mature one found.
   */
  findMatureCrops(bot) {
    for (const crop of CROP_TYPES) {
      const blockId = bot.registry.blocksByName[crop.name]?.id;
      if (blockId === undefined) continue;

      const positions = bot.findBlocks({
        matching: blockId,
        maxDistance: this.searchRadius,
        count: 10,
      });

      // Check maturity for each found position
      for (const pos of positions) {
        const block = bot.blockAt(pos);
        if (block && block.metadata >= crop.maxAge) {
          return { type: crop.name, position: pos, crop };
        }
      }
    }
    return null;
  }

  /**
   * Replant a crop after harvesting.
   * Returns true if successfully replanted, false if no seeds.
   */
  async replant(bot, farmBlock, cropType) {
    const cropDef = CROP_TYPES.find(c => c.name === cropType);
    if (!cropDef) return false;

    const items = bot.inventory.items();
    const seedItem = items.find(i => i.name === cropDef.seed);
    if (!seedItem) return false;

    await bot.equip(seedItem, 'hand');
    await bot.placeBlock(farmBlock, { x: 0, y: 1, z: 0 });
    return true;
  }

  getInventory() {
    return { ...this.harvested };
  }

  getTotalHarvested() {
    return this.totalHarvested;
  }

  // Status reporting resilient to Redis failures
  async _safeReport(status) {
    try { await this.reportStatus(status); } catch (_) { /* Redis down */ }
  }

  // ── Navigation ──────────────────────────────────────────────────

  async navigateToFarm(bot, cropPos) {
    try {
      this.chat.chat('navigating', {
        type: 'crop', x: cropPos.x, y: cropPos.y, z: cropPos.z,
      }).catch(() => {});

      const nav = getNav();
      this._cachedMovements = nav.setupPathfinder(bot, this._cachedMovements);
      const goal = {
        x: cropPos.x, y: cropPos.y, z: cropPos.z, rangeSq: 1,
        isEnd: (node) => {
          const dx = node.x - cropPos.x;
          const dy = node.y - cropPos.y;
          const dz = node.z - cropPos.z;
          return dx * dx + dy * dy + dz * dz <= 4;
        },
        hasChanged: () => false,
      };
      await nav.goto(bot, goal, T.FARMING_NAV_TIMEOUT_MS);
      return { success: true };
    } catch (err) {
      const reason = err.message.includes('timeout') ? 'nav_timeout' : 'nav_error';
      return { success: false, reason };
    }
  }

  // ── Session Loop ──────────────────────────────────────────────

  async executeSession(bot) {
    const startTime = Date.now();
    let cropsHarvested = 0;

    while (Date.now() - startTime < T.FARMING_SESSION_TIMEOUT_MS) {
      const quota = await this.checkQuota();
      if (!quota.hasQuota) break;

      if (this.isInventoryFull(bot)) {
        this.chat.chat('inventory_full', { total: this._countItems(bot) }).catch(() => {});
        break;
      }

      const result = await this.execute(bot);
      if (!result.success) break;
      cropsHarvested++;
    }

    const summary = {
      cropsHarvested,
      inventory: this.getInventory(),
      duration: Date.now() - startTime,
    };
    await this.reportFarmingComplete(summary);
    return summary;
  }

  // ── Inventory Management ──────────────────────────────────────

  isInventoryFull(bot) {
    return this._countItems(bot) >= T.FARMING_INVENTORY_THRESHOLD;
  }

  getInventorySpace(bot) {
    return T.FARMING_INVENTORY_THRESHOLD - this._countItems(bot);
  }

  _countItems(bot) {
    return bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
  }

  // ── Blackboard Coordination ───────────────────────────────────

  async checkQuota() {
    try {
      const quota = await this.board.getConfig('farming:quota');
      if (!quota) return { hasQuota: true };
      return {
        hasQuota: this.totalHarvested < (quota.target ?? Infinity),
        target: quota.target,
        progress: this.totalHarvested,
      };
    } catch (_) {
      return { hasQuota: true };
    }
  }

  async reportFarmingComplete(summary) {
    try {
      await this.board.publish(`agent:${this.id}:farming:complete`, {
        author: this.id, ...summary, timestamp: Date.now(),
      });
    } catch (_) { /* Redis down */ }
  }
}

// Test helper: inject navigation module to avoid loading mineflayer-pathfinder
function _setNav(navModule) { _nav = navModule; }

module.exports = { FarmerAgent, CROP_TYPES, _setNav };
