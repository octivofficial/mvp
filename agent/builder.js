/**
 * Octiv Builder Agent — thin orchestrator
 * Delegates to: builder-navigation, builder-shelter, builder-adaptation
 * Bot control: wood collection, shelter construction, tool crafting
 */
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const { Blackboard } = require('./blackboard');
const { setupPathfinder, goto } = require('./builder-navigation');
const { buildShelter: buildShelterImpl } = require('./builder-shelter');
const { classifyError, selfImprove, tryLearnedSkill } = require('./builder-adaptation');

const { GoalNear, GoalBlock } = goals;
const collectBlock = require('mineflayer-collectblock');

class BuilderAgent {
  constructor(config = {}) {
    this.id = config.id || 'builder-01';
    this.board = new Blackboard();
    this.bot = null;
    this.mcData = null;
    this.reactIterations = 0;
    this.actionHistory = [];
    this.acProgress = { 1: false, 2: false, 3: false, 4: false, 5: false };
    this.adaptations = {
      searchRadius: 32,
      buildSiteRadius: 16,
      waitTicks: 20,
      retries: {},
      maxRetries: 3,
      improvements: [],
    };
    this.logger = null;
    this.skillPipeline = null;
    this.spawnTimeoutMs = config.spawnTimeoutMs || 30000;
  }

  setLogger(logger) { this.logger = logger; }
  setSkillPipeline(pipeline) { this.skillPipeline = pipeline; }

  async init() {
    await this.board.connect();
    this.bot = mineflayer.createBot({
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_PORT) || 25565,
      username: `OctivBot_${this.id}`,
      version: '1.21.1',
      auth: 'offline',
    });

    this.bot.loadPlugin(pathfinder);
    this.bot.loadPlugin(collectBlock.plugin);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[${this.id}] spawn timeout (${this.spawnTimeoutMs}ms) — PaperMC unreachable?`));
      }, this.spawnTimeoutMs);

      this.bot.once('spawn', () => {
        clearTimeout(timeout);
        this.mcData = require('minecraft-data')(this.bot.version);
        resolve();
      });

      this.bot.once('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`[${this.id}] connection error: ${err.message}`));
      });
    });

    this.bot.on('chat', (user, msg) => this._onChat(user, msg));
    this.bot.on('health', () => this._onHealthChange());
    this.bot.on('error', (err) => console.error(`[${this.id}] error:`, err.message));

    await this._onSpawn();
  }

  async _onSpawn() {
    console.log(`[${this.id}] spawned`);
    await this.board.publish(`agent:${this.id}:status`, {
      author: this.id,
      status: 'spawned',
      position: this.bot.entity.position,
    });
    this._reactLoop();
  }

  // ── AC-1: Collect wood ──────────────────────────────────────────
  async collectWood(count = 16) {
    console.log(`[${this.id}] starting wood collection (target: ${count})`);
    const logIds = ['oak_log', 'spruce_log', 'birch_log'].map(n => this.mcData.blocksByName[n]?.id).filter(Boolean);

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
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 1, collected }).catch(e => console.error('[Log]', e.message));
    console.log(`[${this.id}] ✅ AC-1 done: collected ${collected} wood`);
  }

  // ── AC-3: Craft tools ──────────────────────────────────────────
  async craftBasicTools() {
    await this.bot.craft(this.bot.registry.itemsByName.crafting_table, 1, null);
    await this.bot.craft(this.bot.registry.itemsByName.wooden_pickaxe, 1, null);
    this.acProgress[3] = true;
    await this.board.updateAC(this.id, 3, 'done');
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 3 }).catch(e => console.error('[Log]', e.message));
    console.log(`[${this.id}] ✅ AC-3 done: basic tools crafted`);
  }

  // ── AC-2: Build shelter (delegates to builder-shelter) ─────────
  async buildShelter() {
    await buildShelterImpl({
      bot: this.bot,
      mcData: this.mcData,
      board: this.board,
      id: this.id,
      logger: this.logger,
      adaptations: this.adaptations,
      gotoFn: (goal) => this._goto(goal),
      setupPathfinderFn: () => this._setupPathfinder(),
    });
    this.acProgress[2] = true;
  }

  // ── AC-4: Navigate to shelter ──────────────────────────────────
  async gatherAtShelter() {
    console.log(`[${this.id}] heading to shelter`);
    const shelterData = await this.board.get('builder:shelter');
    if (!shelterData?.position) throw new Error('No shelter coordinates found');

    const { x, y, z } = shelterData.position;
    this._setupPathfinder();
    await this._goto(new GoalNear(x + 1, y + 1, z + 1, 2));

    this.acProgress[4] = true;
    await this.board.updateAC(this.id, 4, 'done');
    await this.board.publish('builder:arrived', {
      author: this.id,
      agentId: this.id,
      position: { x, y, z },
    });
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 4, position: { x, y, z } }).catch(e => console.error('[Log]', e.message));
    console.log(`[${this.id}] AC-4 done: arrived at shelter`);
  }

  // ── Phase 2.7: Collect blocks ──────────────────────────────────
  async collectBlocks(blockName, count = 1) {
    console.log(`[${this.id}] collecting ${count}x ${blockName}`);
    const blockType = this.mcData.blocksByName[blockName];
    if (!blockType) throw new Error(`Unknown block: ${blockName}`);

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

    await this.board.publish('builder:collecting', {
      author: this.id,
      agentId: this.id,
      block: blockName,
      collected: blocks.length,
    });
    console.log(`[${this.id}] collected ${blocks.length}x ${blockName}`);
    return blocks.length;
  }

  // ── Navigation (delegates to builder-navigation) ───────────────
  _setupPathfinder() {
    this.movements = setupPathfinder(this.bot, this.movements);
  }

  _goto(goal, timeoutMs = 30000) {
    return goto(this.bot, goal, timeoutMs);
  }

  // ── AC-5 + Skill feedback (delegates to builder-adaptation) ────
  _classifyError(message) { return classifyError(message); }
  async _selfImprove(error) { return selfImprove(this, error); }
  async _tryLearnedSkill(error) { return tryLearnedSkill(this, error); }

  // ── Event handlers ─────────────────────────────────────────────
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

  // ── ReAct loop ─────────────────────────────────────────────────
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
          await this.bot.waitForTicks(40);
        }
      } catch (err) {
        console.error(`[${this.id}] ReAct error:`, err.message);
        if (this.logger) this.logger.logEvent(this.id, { type: 'error', error: err.message, iteration: this.reactIterations }).catch(e => console.error('[Log]', e.message));

        let shouldRetry = true;
        try {
          await this.board.logReflexion(this.id, { error: err.message, iteration: this.reactIterations });
          shouldRetry = await this._selfImprove(err);
          await this._tryLearnedSkill(err);
        } catch (recoveryErr) {
          console.error(`[${this.id}] recovery failed (Redis down?):`, recoveryErr.message);
        }

        if (!shouldRetry) {
          console.warn(`[${this.id}] max retries reached, skipping action`);
        }
        await this.bot.waitForTicks(this.adaptations.waitTicks);
      }
    }
  }

  async shutdown() {
    try {
      if (this.bot) this.bot.end();
    } catch (err) {
      console.error(`[${this.id}] shutdown bot error:`, err.message);
    }
    await this.board.disconnect();
  }
}

module.exports = { BuilderAgent };
