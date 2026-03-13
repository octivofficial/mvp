// MinerAgent.js
const { BaseRole } = require('./BaseRole');
const { AgentChat } = require('../agent-chat');
const { getLogger } = require('../logger');
const log = getLogger();
const T = require('../../config/timeouts');

// Lazy-loaded priority/tier
let ORE_PRIORITY = ['diamond', 'gold', 'lapis', 'redstone', 'copper', 'iron', 'coal'];
let PICKAXE_TIER = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];
const SMELT_RECIPES = {
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  raw_copper: 'copper_ingot',
};

class MinerAgent extends BaseRole {
  constructor(config = {}) {
    super({
      ...config, role: 'miner',
      inventoryThreshold: T.MINING_INVENTORY_THRESHOLD,
      quotaKey: 'mining:quota',
      activityName: 'mining',
      sessionTimeoutMs: T.MINING_SESSION_TIMEOUT_MS,
      navTimeoutMs: T.MINING_NAV_TIMEOUT_MS,
    });
    this.searchRadius = config.searchRadius || 64;
    this.mined = {};       // { coal: 3, iron: 1, ... }
    this.chat = new AgentChat(this.board, this.id, 'miner');
  }

  get totalMined() { return this.totalCount; }
  set totalMined(v) { this.totalCount = v; }

  async execute(bot) {
    await this._safeReport('mining');

    // 1. Find ore
    const orePos = this.findOre(bot);
    if (!orePos) {
      await this._safeReport('searching');
      return { success: false, reason: 'no_ore_found', mined: 0 };
    }

    // 2. Navigate to ore
    const navResult = await this.navigateToOre(bot, orePos);
    if (!navResult.success) {
      return { success: false, reason: navResult.reason, mined: 0 };
    }

    // 3. Get block info
    const block = bot.blockAt(orePos);
    if (!block) {
      return { success: false, reason: 'block_disappeared', mined: 0 };
    }

    // 4. Check if diggable
    if (!bot.canDigBlock(block)) {
      return { success: false, reason: 'cannot_dig', mined: 0 };
    }

    // 5. Equip best pickaxe
    await this.equipBestPickaxe(bot);

    // 6. Mine the ore
    const oreType = this._classifyOre(block.name);
    try {
      await bot.dig(block);
    } catch (err) {
      return { success: false, error: err.message, mined: 0 };
    }

    // 7. Track inventory
    this.mined[oreType] = (this.mined[oreType] || 0) + 1;
    this.totalMined++;

    // 8. Chat about it
    this.chat.chat('ore_mined', {
      type: oreType, total: this.totalMined,
      x: orePos.x, y: orePos.y, z: orePos.z,
    }).catch(e => log.debug('miner', 'chat error', { error: e.message }));

    // Confess on rare find (diamond, gold, lapis)
    if (['diamond', 'gold', 'lapis'].includes(oreType)) {
      this.chat.confess('rare_find', {
        type: oreType, y: orePos.y,
      }).catch(e => log.debug('miner', 'chat error', { error: e.message }));
    }

    // Confess on milestone (every 10 ores)
    if (this.totalMined > 0 && this.totalMined % 10 === 0) {
      this.chat.confess('mining_milestone', {
        total: this.totalMined, inventory: { ...this.mined },
      }).catch(e => log.debug('miner', 'chat error', { error: e.message }));
    }

    // 9. Publish to Blackboard (resilient to Redis failure)
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

  // ── Navigation ──────────────────────────────────────────────────

  async navigateToOre(bot, orePos) {
    const type = this._classifyOre(bot.blockAt(orePos)?.name || 'ore');
    return this.navigateTo(bot, orePos, type, this.navTimeoutMs);
  }

  // ── Session Loop (inherited from BaseRole.executeSession) ──────

  _buildSessionSummary(count) {
    return { oresMined: count, inventory: this.getInventory() };
  }

  // Alias: reportMiningComplete → reportActivityComplete
  async reportMiningComplete(summary) {
    return this.reportActivityComplete(summary);
  }

  // ── Smelting ──────────────────────────────────────────────────

  canSmelt(itemName) {
    return SMELT_RECIPES[itemName] !== undefined;
  }

  async findFurnace(bot) {
    const id = bot.registry.blocksByName.furnace?.id;
    if (!id) return null;
    const positions = bot.findBlocks({ matching: id, maxDistance: 32, count: 1 });
    return positions.length > 0 ? positions[0] : null;
  }

  async smelt(bot, furnacePos) {
    await this.navigateTo(bot, furnacePos, 'furnace', T.MINING_NAV_TIMEOUT_MS);

    const block = bot.blockAt(furnacePos);
    const furnace = await bot.openFurnace(block);
    const items = bot.inventory.items().filter(i => this.canSmelt(i.name));
    for (const item of items) {
      await furnace.putInput(item.type, null, item.count);
    }
    await furnace.close();
    this.chat.chat('smelting', { count: items.length, type: 'ores' }).catch(e => log.debug('miner', 'chat error', { error: e.message }));
  }

  // ── Internal Helpers ──────────────────────────────────────────

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

module.exports = { MinerAgent, ORE_PRIORITY, PICKAXE_TIER, SMELT_RECIPES };
