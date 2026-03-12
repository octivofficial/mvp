// FarmerAgent.js
const { BaseRole } = require('./BaseRole');
const { AgentChat } = require('../agent-chat');
const T = require('../../config/timeouts');

// Crop definitions with harvest maturity (metadata value at full growth)
const CROP_TYPES = [
  { name: 'wheat', seed: 'wheat_seeds', maxAge: 7 },
  { name: 'carrots', seed: 'carrot', maxAge: 7 },
  { name: 'potatoes', seed: 'potato', maxAge: 7 },
  { name: 'beetroots', seed: 'beetroot_seeds', maxAge: 3 },
];

class FarmerAgent extends BaseRole {
  constructor(config = {}) {
    super({
      ...config, role: 'farmer',
      inventoryThreshold: T.FARMING_INVENTORY_THRESHOLD,
      quotaKey: 'farming:quota',
      activityName: 'farming',
      sessionTimeoutMs: T.FARMING_SESSION_TIMEOUT_MS,
      navTimeoutMs: T.FARMING_NAV_TIMEOUT_MS,
    });
    this.searchRadius = config.searchRadius || 64;
    this.harvested = {};     // { wheat: 5, carrots: 2, ... }
    this.chat = new AgentChat(this.board, this.id, 'farmer');
  }

  get totalHarvested() { return this.totalCount; }
  set totalHarvested(v) { this.totalCount = v; }

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

  // ── Navigation ──────────────────────────────────────────────────

  async navigateToFarm(bot, cropPos) {
    return this.navigateTo(bot, cropPos, 'crop', this.navTimeoutMs);
  }

  // ── Session Loop (inherited from BaseRole.executeSession) ──────

  _buildSessionSummary(count) {
    return { cropsHarvested: count, inventory: this.getInventory() };
  }

  // Alias: reportFarmingComplete → reportActivityComplete
  async reportFarmingComplete(summary) {
    return this.reportActivityComplete(summary);
  }
}

module.exports = { FarmerAgent, CROP_TYPES };
