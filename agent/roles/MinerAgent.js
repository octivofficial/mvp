/**
 * Octiv Miner Role — Phase 7.2 Agent Expansion
 * Specialized ore mining agent with priority-based ore selection.
 * Searches for ores, equips best pickaxe, mines, and reports via Blackboard.
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

// Priority order: rarest first (attempt high-value before common)
const ORE_PRIORITY = ['diamond', 'gold', 'lapis', 'redstone', 'copper', 'iron', 'coal'];

// Pickaxe tier: higher index = better tool
const PICKAXE_TIER = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];

// Smelting recipes: raw ore name -> ingot name
const SMELT_RECIPES = {
  raw_iron: 'iron_ingot',
  raw_gold: 'gold_ingot',
  raw_copper: 'copper_ingot',
};

class MinerAgent extends BaseRole {
  constructor(config = {}) {
    super({ ...config, role: 'miner' });
    this.searchRadius = config.searchRadius || 64;
    this.mined = {};       // { coal: 3, iron: 1, ... }
    this.totalMined = 0;
    this.chat = new AgentChat(this.board, this.id, 'miner');
    this._cachedMovements = null;
  }

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
    }).catch(() => {});

    // Confess on rare find (diamond, gold, lapis)
    if (['diamond', 'gold', 'lapis'].includes(oreType)) {
      this.chat.confess('rare_find', {
        type: oreType, y: orePos.y,
      }).catch(() => {});
    }

    // Confess on milestone (every 10 ores)
    if (this.totalMined > 0 && this.totalMined % 10 === 0) {
      this.chat.confess('mining_milestone', {
        total: this.totalMined, inventory: { ...this.mined },
      }).catch(() => {});
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

  // ── Navigation ──────────────────────────────────────────────────

  /**
   * Navigate to an ore position using pathfinder.
   * @returns {{ success: boolean, reason?: string }}
   */
  async navigateToOre(bot, orePos) {
    try {
      this.chat.chat('navigating', {
        type: this._classifyOre(bot.blockAt(orePos)?.name || 'ore'),
        x: orePos.x, y: orePos.y, z: orePos.z,
      }).catch(() => {});

      const nav = getNav();
      this._cachedMovements = nav.setupPathfinder(bot, this._cachedMovements);
      const goal = { x: orePos.x, y: orePos.y, z: orePos.z, rangeSq: 1, isEnd: (node) => {
        const dx = node.x - orePos.x;
        const dy = node.y - orePos.y;
        const dz = node.z - orePos.z;
        return dx * dx + dy * dy + dz * dz <= 4; // within ~2 blocks
      }, hasChanged: () => false };
      await nav.goto(bot, goal, T.MINING_NAV_TIMEOUT_MS);
      return { success: true };
    } catch (err) {
      const reason = err.message.includes('timeout') ? 'nav_timeout' : 'nav_error';
      return { success: false, reason };
    }
  }

  // ── Session Loop ──────────────────────────────────────────────

  /**
   * Run a continuous mining session until timeout, inventory full, no ore, or quota reached.
   * @returns {{ oresMined: number, inventory: object, duration: number }}
   */
  async executeSession(bot) {
    const startTime = Date.now();
    let oresMined = 0;

    while (Date.now() - startTime < T.MINING_SESSION_TIMEOUT_MS) {
      // Check quota
      const quota = await this.checkQuota();
      if (!quota.hasQuota) break;

      // Check inventory
      if (this.isInventoryFull(bot)) {
        this.chat.chat('inventory_full', { total: this._countItems(bot) }).catch(() => {});
        break;
      }

      const result = await this.execute(bot);
      if (!result.success) break;
      oresMined++;
    }

    const summary = {
      oresMined,
      inventory: this.getInventory(),
      duration: Date.now() - startTime,
    };
    await this.reportMiningComplete(summary);
    return summary;
  }

  // ── Inventory Management ──────────────────────────────────────

  isInventoryFull(bot) {
    return this._countItems(bot) >= T.MINING_INVENTORY_THRESHOLD;
  }

  getInventorySpace(bot) {
    return T.MINING_INVENTORY_THRESHOLD - this._countItems(bot);
  }

  _countItems(bot) {
    return bot.inventory.items().reduce((sum, item) => sum + item.count, 0);
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
    const nav = getNav();
    this._cachedMovements = nav.setupPathfinder(bot, this._cachedMovements);
    const goal = { x: furnacePos.x, y: furnacePos.y, z: furnacePos.z, rangeSq: 1, isEnd: (node) => {
      const dx = node.x - furnacePos.x;
      const dy = node.y - furnacePos.y;
      const dz = node.z - furnacePos.z;
      return dx * dx + dy * dy + dz * dz <= 4;
    }, hasChanged: () => false };
    await nav.goto(bot, goal, T.MINING_NAV_TIMEOUT_MS);

    const block = bot.blockAt(furnacePos);
    const furnace = await bot.openFurnace(block);
    const items = bot.inventory.items().filter(i => this.canSmelt(i.name));
    for (const item of items) {
      await furnace.putInput(item.type, null, item.count);
    }
    await furnace.close();
    this.chat.chat('smelting', { count: items.length, type: 'ores' }).catch(() => {});
  }

  // ── Blackboard Coordination ───────────────────────────────────

  async checkQuota() {
    try {
      const quota = await this.board.getConfig('mining:quota');
      if (!quota) return { hasQuota: true };
      return {
        hasQuota: this.totalMined < (quota.target ?? Infinity),
        target: quota.target,
        progress: this.totalMined,
      };
    } catch (_) {
      return { hasQuota: true };
    }
  }

  async reportMiningComplete(summary) {
    try {
      await this.board.publish(`agent:${this.id}:mining:complete`, {
        author: this.id, ...summary, timestamp: Date.now(),
      });
    } catch (_) { /* Redis down */ }
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

// Test helper: inject navigation module to avoid loading mineflayer-pathfinder
function _setNav(navModule) { _nav = navModule; }

module.exports = { MinerAgent, ORE_PRIORITY, PICKAXE_TIER, SMELT_RECIPES, _setNav };
