/**
 * Octiv Miner Role — Phase 7.2 Agent Expansion
 * Specialized ore mining agent with priority-based ore selection.
 * Searches for ores, equips best pickaxe, mines, and reports via Blackboard.
 */
const { BaseRole } = require('./BaseRole');
const { AgentChat } = require('../agent-chat');

// Priority order: rarest first (attempt high-value before common)
const ORE_PRIORITY = ['diamond', 'gold', 'lapis', 'redstone', 'copper', 'iron', 'coal'];

// Pickaxe tier: higher index = better tool
const PICKAXE_TIER = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];

class MinerAgent extends BaseRole {
  constructor(config = {}) {
    super({ ...config, role: 'miner' });
    this.searchRadius = config.searchRadius || 64;
    this.mined = {};       // { coal: 3, iron: 1, ... }
    this.totalMined = 0;
    this.chat = new AgentChat(this.board, this.id, 'miner');
  }

  async execute(bot) {
    await this._safeReport('mining');

    // 1. Find ore
    const orePos = this.findOre(bot);
    if (!orePos) {
      await this._safeReport('searching');
      return { success: false, reason: 'no_ore_found', mined: 0 };
    }

    // 2. Get block info
    const block = bot.blockAt(orePos);
    if (!block) {
      return { success: false, reason: 'block_disappeared', mined: 0 };
    }

    // 3. Check if diggable
    if (!bot.canDigBlock(block)) {
      return { success: false, reason: 'cannot_dig', mined: 0 };
    }

    // 4. Equip best pickaxe
    await this.equipBestPickaxe(bot);

    // 5. Mine the ore
    const oreType = this._classifyOre(block.name);
    try {
      await bot.dig(block);
    } catch (err) {
      return { success: false, error: err.message, mined: 0 };
    }

    // 6. Track inventory
    this.mined[oreType] = (this.mined[oreType] || 0) + 1;
    this.totalMined++;

    // 7. Chat about it
    this.chat.chat('ore_mined', {
      type: oreType, total: this.totalMined,
      x: orePos.x, y: orePos.y, z: orePos.z,
    }).catch(() => {});

    // Confess on milestone (every 10 ores)
    if (this.totalMined > 0 && this.totalMined % 10 === 0) {
      this.chat.confess('mining_milestone', {
        total: this.totalMined, inventory: { ...this.mined },
      }).catch(() => {});
    }

    // 8. Publish to Blackboard (resilient to Redis failure)
    try {
      await this.board.publish(`agent:${this.id}:mining`, {
        author: this.id, ore: oreType,
        position: orePos, mined: this.totalMined,
      });
    } catch (_) { /* Redis down — mining still succeeds */ }

    return {
      success: true,
      ore: oreType,
      mined: this.totalMined,
      position: orePos,
    };
  }

  // Status reporting resilient to Redis failures
  async _safeReport(status) {
    try { await this.reportStatus(status); } catch (_) { /* Redis down */ }
  }

  /**
   * Search for the highest-priority ore within search radius.
   * Tries each ore type in priority order (diamond first, coal last).
   */
  findOre(bot) {
    for (const oreType of ORE_PRIORITY) {
      const ids = this._getOreBlockIds(bot, oreType);
      if (ids.length === 0) continue;

      const positions = bot.findBlocks({
        matching: ids,
        maxDistance: this.searchRadius,
        count: 1,
      });

      if (positions.length > 0) return positions[0];
    }
    return null;
  }

  /**
   * Equip the best pickaxe available in inventory.
   * Returns true if a pickaxe was equipped, false otherwise.
   */
  async equipBestPickaxe(bot) {
    const items = bot.inventory.items();
    let bestPick = null;
    let bestTier = -1;

    for (const item of items) {
      const tier = PICKAXE_TIER.indexOf(item.name);
      if (tier > bestTier) {
        bestTier = tier;
        bestPick = item;
      }
    }

    if (!bestPick) return false;
    await bot.equip(bestPick, 'hand');
    return true;
  }

  getInventory() {
    return { ...this.mined };
  }

  getTotalMined() {
    return this.totalMined;
  }

  // Map ore block names to ore type (strip deepslate_ prefix and _ore suffix)
  _classifyOre(blockName) {
    const name = blockName.replace('deepslate_', '').replace('_ore', '');
    return name;
  }

  // Get all block IDs for an ore type (normal + deepslate variants)
  _getOreBlockIds(bot, oreType) {
    const names = [`${oreType}_ore`, `deepslate_${oreType}_ore`];
    return names
      .map(n => bot.registry.blocksByName[n]?.id)
      .filter(id => id !== undefined);
  }
}

module.exports = { MinerAgent, ORE_PRIORITY, PICKAXE_TIER };
