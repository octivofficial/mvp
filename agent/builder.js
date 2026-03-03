/**
 * Octiv Builder Agent — coding-agent + mineflayer role
 * Bot control: wood collection, shelter construction, tool crafting
 */
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Blackboard } = require('./blackboard');

const { GoalNear, GoalBlock } = goals;
const collectBlock = require('mineflayer-collectblock');
const { Vec3 } = require('vec3');

class BuilderAgent {
  constructor(config = {}) {
    this.id = config.id || 'builder-01';
    this.board = new Blackboard();
    this.bot = null;
    this.mcData = null; // cached minecraft-data instance
    this.reactIterations = 0;
    this.actionHistory = [];
    this.acProgress = { 1: false, 2: false, 3: false, 4: false, 5: false };
    this.adaptations = {
      searchRadius: 32,
      buildSiteRadius: 16,
      waitTicks: 20,
      retries: {},       // per-action retry counts
      maxRetries: 3,
      improvements: [],  // log of applied improvements
    };
    this.logger = null;
  }

  setLogger(logger) { this.logger = logger; }

  async init() {
    await this.board.connect();
    this.bot = mineflayer.createBot({
      host: 'localhost',
      port: 25565,
      username: `OctivBot_${this.id}`,
      version: '1.21.1',
      auth: 'offline',
    });

    this.bot.loadPlugin(pathfinder);
    this.bot.loadPlugin(collectBlock.plugin);

    this.bot.once('spawn', () => {
      this.mcData = require('minecraft-data')(this.bot.version);
      this._onSpawn();
    });
    this.bot.on('chat', (user, msg) => this._onChat(user, msg));
    this.bot.on('health', () => this._onHealthChange());
    this.bot.on('error', (err) => console.error(`[${this.id}] error:`, err.message));
  }

  async _onSpawn() {
    console.log(`[${this.id}] spawned`);
    await this.board.publish(`agent:${this.id}:status`, {
      author: this.id,
      status: 'spawned',
      position: this.bot.entity.position,
    });
    // Start ReAct loop
    this._reactLoop();
  }

  // AC-1: Collect 16 wood logs
  async collectWood(count = 16) {
    console.log(`[${this.id}] starting wood collection (target: ${count})`);
    const logIds = ['oak_log', 'spruce_log', 'birch_log'].map(n => this.mcData.blocksByName[n]?.id).filter(Boolean);

    // Set up pathfinder once for entire collection loop
    this._setupPathfinder();

    let collected = 0;
    while (collected < count) {
      const log = this.bot.findBlock({ matching: logIds, maxDistance: this.adaptations.searchRadius });
      if (!log) { await this.bot.waitForTicks(20); continue; }

      await this._goto(new GoalBlock(log.position.x, log.position.y, log.position.z));
      await this.bot.dig(log);
      collected++;

      await this.board.updateAC(this.id, 1, collected >= count ? 'done' : 'in_progress');
      await this.board.publish(`agent:${this.id}:inventory`, { author: this.id, wood: collected });
    }

    this.acProgress[1] = true;
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 1, collected });
    console.log(`[${this.id}] ✅ AC-1 done: collected ${collected} wood`);
  }

  // AC-3: Craft basic tools
  async craftBasicTools() {
    await this.bot.craft(this.bot.registry.itemsByName.crafting_table, 1, null);
    await this.bot.craft(this.bot.registry.itemsByName.wooden_pickaxe, 1, null);
    this.acProgress[3] = true;
    await this.board.updateAC(this.id, 3, 'done');
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 3 });
    console.log(`[${this.id}] ✅ AC-3 done: basic tools crafted`);
  }

  // AC-2: Build 3x3x3 shelter
  async buildShelter() {
    console.log(`[${this.id}] starting shelter construction`);

    // 1. Craft planks from logs
    await this._craftPlanks();

    // 2. Find flat build site
    const origin = await this._findBuildSite();
    if (!origin) throw new Error('No suitable build site found');

    // 3. Set up pathfinder once for all block placements
    this._setupPathfinder();

    // 4. Build shell: floor(y=0), walls(y=1,2), roof(y=3)
    const plankName = 'oak_planks';

    for (let dy = 0; dy <= 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        for (let dz = 0; dz < 3; dz++) {
          const isFloor = (dy === 0);
          const isRoof = (dy === 3);
          const isWall = (dy === 1 || dy === 2);
          const isEdge = (dx === 0 || dx === 2 || dz === 0 || dz === 2);
          const isDoor = (dx === 1 && dz === 0 && (dy === 1 || dy === 2));

          if (isDoor) continue;
          if (isFloor || isRoof) { /* place block */ }
          else if (isWall && isEdge) { /* place block */ }
          else continue;

          const pos = origin.offset(dx, dy, dz);
          await this._placeBlockAt(pos, plankName);
        }
      }
    }

    // 4. Publish shelter coords
    this.acProgress[2] = true;
    await this.board.updateAC(this.id, 2, 'done');
    await this.board.publish(`builder:shelter`, {
      author: this.id,
      position: { x: origin.x, y: origin.y, z: origin.z },
      size: { x: 3, y: 4, z: 3 },
    });
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 2, position: { x: origin.x, y: origin.y, z: origin.z } });
    console.log(`[${this.id}] AC-2 done: shelter at ${origin}`);
  }

  // Craft oak_planks from oak_log in inventory
  async _craftPlanks() {
    const planksItem = this.mcData.itemsByName.oak_planks;
    if (!planksItem) return;
    const logItem = this.bot.inventory.items().find(i => i.name === 'oak_log');
    if (!logItem) return;
    // bot.craft() expects a recipe, not an item — look up recipes for oak_planks
    const recipes = this.bot.recipesFor(planksItem.id, null, 1, null);
    if (!recipes || recipes.length === 0) return;
    const count = Math.min(logItem.count, 9); // up to 9 logs → 36 planks
    for (let i = 0; i < count; i++) {
      await this.bot.craft(recipes[0], 1, null);
    }
  }

  // Find flat 3x3 site: solid ground + air above (radius 16)
  async _findBuildSite() {
    const botPos = this.bot.entity.position.floored();
    for (let r = 1; r <= this.adaptations.buildSiteRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // perimeter only
          const base = botPos.offset(dx, -1, dz);
          if (this._isFlatSite(base)) return botPos.offset(dx, 0, dz);
        }
      }
    }
    return null;
  }

  // Check 3x3 ground is solid + 4 layers of air above
  _isFlatSite(groundCorner) {
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) {
        const ground = this.bot.blockAt(groundCorner.offset(x, 0, z));
        if (!ground || ground.boundingBox !== 'block') return false;
        for (let y = 1; y <= 4; y++) {
          const air = this.bot.blockAt(groundCorner.offset(x, y, z));
          if (air && air.boundingBox === 'block') return false;
        }
      }
    }
    return true;
  }

  // Navigate near and place block (pathfinder movements must be set before calling)
  async _placeBlockAt(pos, blockName) {
    await this._goto(new GoalNear(pos.x, pos.y, pos.z, 4));

    const item = this.bot.inventory.items().find(i => i.name === blockName);
    if (!item) throw new Error(`No ${blockName} in inventory`);
    await this.bot.equip(item, 'hand');

    const referenceBlock = this.bot.blockAt(pos.offset(0, -1, 0));
    if (referenceBlock) {
      await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
    }
  }

  // AC-4: Navigate to shelter and report arrival
  async gatherAtShelter() {
    console.log(`[${this.id}] heading to shelter`);
    const shelterData = await this.board.get('builder:shelter');
    if (!shelterData?.position) throw new Error('No shelter coordinates found');

    const { x, y, z } = shelterData.position;
    this._setupPathfinder();
    // Navigate to shelter interior (center of floor, one block up)
    await this._goto(new GoalNear(x + 1, y + 1, z + 1, 2));

    this.acProgress[4] = true;
    await this.board.updateAC(this.id, 4, 'done');
    await this.board.publish(`builder:arrived`, {
      author: this.id,
      agentId: this.id,
      position: { x, y, z },
    });
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 4, position: { x, y, z } });
    console.log(`[${this.id}] AC-4 done: arrived at shelter`);
  }

  // Phase 2.7: Collect blocks using mineflayer-collectblock with auto-equip
  async collectBlocks(blockName, count = 1) {
    console.log(`[${this.id}] collecting ${count}x ${blockName}`);
    const blockType = this.mcData.blocksByName[blockName];
    if (!blockType) throw new Error(`Unknown block: ${blockName}`);

    // Auto-equip best tool
    const tools = this.bot.inventory.items().filter(i =>
      i.name.includes('pickaxe') || i.name.includes('axe') || i.name.includes('shovel')
    );
    if (tools.length > 0) {
      await this.bot.equip(tools[0], 'hand');
    }

    const targets = this.bot.findBlocks({
      matching: blockType.id,
      maxDistance: this.adaptations.searchRadius,
      count,
    });

    if (targets.length === 0) throw new Error(`No ${blockName} found nearby`);

    const blocks = targets.map(pos => this.bot.blockAt(pos)).filter(Boolean);
    await this.bot.collectBlock.collect(blocks);

    await this.board.publish(`builder:collecting`, {
      author: this.id,
      agentId: this.id,
      block: blockName,
      collected: blocks.length,
    });
    console.log(`[${this.id}] collected ${blocks.length}x ${blockName}`);
    return blocks.length;
  }

  // Optimization: reuse Movements instance across calls
  _setupPathfinder() {
    if (!this.movements) {
      this.movements = new Movements(this.bot);
    }
    this.bot.pathfinder.setMovements(this.movements);
  }

  // Pathfinder goto with timeout (default 30s) to prevent infinite navigation
  _goto(goal, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.bot.pathfinder.stop();
        reject(new Error(`Pathfinding timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.bot.pathfinder.goto(goal).then(() => {
        clearTimeout(timer);
        resolve();
      }).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // AC-5: Self-improvement on failure
  async _selfImprove(error) {
    const errorType = this._classifyError(error.message);
    const retryKey = errorType;
    this.adaptations.retries[retryKey] = (this.adaptations.retries[retryKey] || 0) + 1;
    const retryCount = this.adaptations.retries[retryKey];

    let improvement = null;

    if (errorType === 'build_site' && this.adaptations.buildSiteRadius < 64) {
      this.adaptations.buildSiteRadius = Math.min(64, this.adaptations.buildSiteRadius + 8);
      improvement = { type: 'expand_build_radius', value: this.adaptations.buildSiteRadius };
    } else if (errorType === 'pathfinding' && this.adaptations.waitTicks < 100) {
      this.adaptations.waitTicks = Math.min(100, this.adaptations.waitTicks + 10);
      improvement = { type: 'increase_wait', value: this.adaptations.waitTicks };
    } else if (errorType === 'inventory') {
      this.adaptations.searchRadius = Math.min(128, this.adaptations.searchRadius + 16);
      improvement = { type: 'expand_search_radius', value: this.adaptations.searchRadius };
    } else if (errorType === 'unknown') {
      this.adaptations.waitTicks = Math.min(100, this.adaptations.waitTicks + 5);
      improvement = { type: 'increase_wait', value: this.adaptations.waitTicks };
    }

    if (improvement) {
      improvement.retry = retryCount;
      improvement.error = error.message;
      this.adaptations.improvements.push(improvement);

      await this.board.publish(`agent:${this.id}:improvement`, { author: this.id, ...improvement });
      await this.board.logReflexion(this.id, {
        type: 'self_improve',
        errorType,
        improvement,
        iteration: this.reactIterations,
      });
      if (this.logger) this.logger.logEvent(this.id, { type: 'self_improve', ...improvement });
      console.log(`[${this.id}] AC-5 self-improve: ${improvement.type} → ${improvement.value}`);

      // Mark AC-5 done on first successful adaptation
      if (!this.acProgress[5]) {
        this.acProgress[5] = true;
        await this.board.updateAC(this.id, 5, 'done');
      }
    }

    return retryCount <= this.adaptations.maxRetries;
  }

  _classifyError(message) {
    const msg = message.toLowerCase();
    if (msg.includes('build site') || msg.includes('flat')) return 'build_site';
    if (msg.includes('path') || msg.includes('goal') || msg.includes('movement')) return 'pathfinding';
    if (msg.includes('inventory') || msg.includes('no oak') || msg.includes('no item')) return 'inventory';
    if (msg.includes('shelter') || msg.includes('coordinates')) return 'shelter';
    return 'unknown';
  }

  // Monitor health changes
  async _onHealthChange() {
    await this.board.publish(`agent:${this.id}:health`, {
      author: this.id,
      health: this.bot.health,
      food: this.bot.food,
    });
  }

  _onChat(username, message) {
    if (username === this.bot.username) return;
    console.log(`[${this.id}] chat [${username}]: ${message}`);
  }

  // Main ReAct loop
  async _reactLoop() {
    while (true) {
      this.reactIterations++;
      await this.board.publish(`agent:${this.id}:react`, { author: this.id, iteration: this.reactIterations });

      try {
        if (!this.acProgress[1]) {
          await this.collectWood(16);
        } else if (!this.acProgress[3]) {
          await this.craftBasicTools();
        } else if (!this.acProgress[2]) {
          await this.buildShelter();
        } else if (!this.acProgress[4]) {
          await this.gatherAtShelter();
        } else {
          // All ACs done — idle
          await this.bot.waitForTicks(40);
        }
      } catch (err) {
        console.error(`[${this.id}] ReAct error:`, err.message);
        if (this.logger) this.logger.logEvent(this.id, { type: 'error', error: err.message, iteration: this.reactIterations });
        await this.board.logReflexion(this.id, { error: err.message, iteration: this.reactIterations });
        const shouldRetry = await this._selfImprove(err);
        if (!shouldRetry) {
          console.warn(`[${this.id}] max retries reached, skipping action`);
        }
        await this.bot.waitForTicks(this.adaptations.waitTicks);
      }
    }
  }

  async shutdown() {
    this.bot?.end();
    await this.board.disconnect();
  }
}

module.exports = { BuilderAgent };
