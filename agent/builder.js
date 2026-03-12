// agent/builder.js
const { Blackboard } = require('./blackboard');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const { AgentChat } = require('./agent-chat');
const log = getLogger();

// Lazy-loaded dependencies
let mineflayer = null;
let pathfinder = null;
let goals = null;
let collectBlock = null;
let setupPathfinder = null;
let goto = null;
let buildShelterImpl = null;
let classifyError = null;
let selfImprove = null;
let tryLearnedSkill = null;

function _loadDeps() {
  if (!mineflayer) {
    try {
      mineflayer = require('mineflayer');
      const pf = require('mineflayer-pathfinder');
      pathfinder = pf.pathfinder;
      goals = pf.goals;
      collectBlock = require('mineflayer-collectblock');
      
      const nav = require('./builder-navigation');
      setupPathfinder = nav.setupPathfinder;
      goto = nav.goto;
      
      const shelter = require('./builder-shelter');
      buildShelterImpl = shelter.buildShelter;
      
      const adapt = require('./builder-adaptation');
      classifyError = adapt.classifyError;
      selfImprove = adapt.selfImprove;
      tryLearnedSkill = adapt.tryLearnedSkill;
    } catch (err) {
      log.warn('builder', 'Missing mineflayer dependencies. Role will be disabled.', { error: err.message });
      return false;
    }
  }
  return true;
}

const MAX_WANDER_ATTEMPTS = 15;
const WANDER_DISTANCE = 75; // blocks
const SEARCH_RADIUS_INCREMENT = 16;
const MAX_SEARCH_RADIUS = 128;

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
      searchRadius: 64,
      buildSiteRadius: 16,
      waitTicks: 20,
      retries: {},
      maxRetries: 3,
      improvements: [],
    };
    this.logger = null;
    this.skillPipeline = null;
    this.spawnTimeoutMs = config.spawnTimeoutMs || T.SPAWN_TIMEOUT_MS;
    this._running = true;
    this._lastMission = null;
    this._missionSubscriber = null;
    this.chat = new AgentChat(this.board, this.id, 'builder');
  }

  setLogger(logger) { this.logger = logger; }
  setSkillPipeline(pipeline) { this.skillPipeline = pipeline; }

  async init() {
    if (!_loadDeps()) {
      throw new Error('Required mineflayer dependencies not found');
    }
    await this.board.connect();
    this.bot = mineflayer.createBot({
      host: process.env.MC_HOST || 'localhost',
      port: parseInt(process.env.MC_PORT) || 25565,
      username: `Octiv_${this.id}`,
      version: process.env.MC_VERSION || '1.21.11',
      auth: 'offline',
      checkTimeoutInterval: 60000, 
      keepAlive: true,
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
    this.bot.on('error', (err) => log.error(this.id, 'bot error', { error: err.message }));
    this.bot.on('death', () => this._onDeath());

    await this._onSpawn();
  }

  async _onSpawn() {
    log.info(this.id, 'spawned');
    await this._waitForGround();
    await this._setupMissionSubscriber();
    await this.board.publish(`agent:${this.id}:status`, {
      author: this.id,
      status: 'spawned',
      position: this.bot.entity.position,
    });
    this._reactLoop();
  }

  async _waitForGround() {
    const maxWait = T.SPAWN_GROUND_WAIT_MS;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (this.bot.entity.velocity.y >= 0) return;
      await this.bot.waitForTicks(1);
    }
  }

  // ── AC-1: Collect wood ──────────────────────────────────────────
  async collectWood(count = 16) {
    const { GoalBlock } = goals;
    log.info(this.id, `starting wood collection (target: ${count})`);
    const LOG_TYPES = [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
      'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
    ];
    const logIds = LOG_TYPES.map(n => this.mcData.blocksByName[n]?.id).filter(Boolean);

    this._setupPathfinder();

    let collected = 0;
    let wanderFailures = 0;
    while (collected < count) {
      const woodLog = this.bot.findBlock({ matching: logIds, maxDistance: this.adaptations.searchRadius });
      if (!woodLog) {
        wanderFailures++;
        log.warn(this.id, `no wood within ${this.adaptations.searchRadius} blocks (attempt ${wanderFailures}/${MAX_WANDER_ATTEMPTS})`);

        if (wanderFailures >= MAX_WANDER_ATTEMPTS) {
          throw new Error(`no wood found after ${MAX_WANDER_ATTEMPTS} wander attempts`);
        }

        // Auto-expand search radius every 2 failures
        if (wanderFailures % 2 === 0 && this.adaptations.searchRadius < MAX_SEARCH_RADIUS) {
          this.adaptations.searchRadius = Math.min(MAX_SEARCH_RADIUS, this.adaptations.searchRadius + SEARCH_RADIUS_INCREMENT);
          log.info(this.id, `expanded searchRadius to ${this.adaptations.searchRadius}`);
        }

        if (wanderFailures >= 5) {
          this.chat.confess('repeated_failure', { failures: wanderFailures }).catch(() => {});
        }

        const wp = this.bot.entity.position;
        this.chat.chat('wandering', { x: Math.round(wp.x), z: Math.round(wp.z) }).catch(() => {});
        await this._wander();
        continue;
      }
      wanderFailures = 0; // reset on success

      this.chat.chat('wood_found', { blockType: woodLog.name, x: woodLog.position.x, z: woodLog.position.z }).catch(() => {});
      await this._goto(new GoalBlock(woodLog.position.x, woodLog.position.y, woodLog.position.z));
      await this.bot.dig(woodLog);
      collected++;

      await this.board.updateAC(this.id, 1, collected >= count ? 'done' : 'in_progress');
      await this.board.publish(`agent:${this.id}:inventory`, { author: this.id, wood: collected });
    }

    this.acProgress[1] = true;
    this.chat.chat('wood_complete', { count: collected }).catch(() => {});
    this.chat.confess('ac_complete', { ac: 1, count: collected }).catch(() => {});
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 1, collected }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));
    log.info(this.id, `AC-1 done: collected ${collected} wood`);
  }

  // ── AC-3: Craft tools ──────────────────────────────────────────
  async craftBasicTools() {
    await this.bot.craft(this.bot.registry.itemsByName.crafting_table, 1, null);
    await this.bot.craft(this.bot.registry.itemsByName.wooden_pickaxe, 1, null);
    this.acProgress[3] = true;
    await this.board.updateAC(this.id, 3, 'done');
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 3 }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));
    log.info(this.id, 'AC-3 done: basic tools crafted');
  }

  // ── AC-2: Build shelter (delegates to builder-shelter) ─────────
  async buildShelter() {
    if (!buildShelterImpl) _loadDeps();
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
    const shelterPos = (await this.board.get('builder:shelter'))?.position || {};
    this.chat.chat('shelter_complete', { x: shelterPos.x, y: shelterPos.y, z: shelterPos.z }).catch(() => {});
  }

  // ── AC-4: Navigate to shelter ──────────────────────────────────
  async gatherAtShelter() {
    log.info(this.id, 'heading to shelter');
    const shelterData = await this.board.get('builder:shelter');
    if (!shelterData?.position) throw new Error('No shelter coordinates found');

    const { GoalNear } = goals;
    const { x, y, z } = shelterData.position;
    this._setupPathfinder();
    await this._goto(new GoalNear(x + 1, y + 1, z + 1, 2));

    this.acProgress[4] = true;
    this.chat.chat('arrived_shelter', {}).catch(() => {});
    await this.board.updateAC(this.id, 4, 'done');
    await this.board.publish('builder:arrived', {
      author: this.id,
      agentId: this.id,
      position: { x, y, z },
    });
    if (this.logger) this.logger.logEvent(this.id, { type: 'ac_complete', ac: 4, position: { x, y, z } }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));
    log.info(this.id, 'AC-4 done: arrived at shelter');
  }

  // ── Phase 2.7: Collect blocks ──────────────────────────────────
  async collectBlocks(blockName, count = 1) {
    log.info(this.id, `collecting ${count}x ${blockName}`);
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
    log.info(this.id, `collected ${blocks.length}x ${blockName}`);
    return blocks.length;
  }

  // ── Navigation (delegates to builder-navigation) ───────────────
  _setupPathfinder() {
    this.movements = setupPathfinder(this.bot, this.movements);
  }

  _goto(goal, timeoutMs = T.PATHFINDER_TIMEOUT_MS) {
    return goto(this.bot, goal, timeoutMs);
  }

  // ── Wander: random exploration when no resources found ────────
  async _wander() {
    const pos = this.bot.entity.position;
    const angle = Math.random() * 2 * Math.PI;
    const dx = Math.round(Math.cos(angle) * WANDER_DISTANCE);
    const dz = Math.round(Math.sin(angle) * WANDER_DISTANCE);

    const { GoalXZ } = goals;
    log.info(this.id, `wandering to (${pos.x + dx}, ${pos.z + dz})`);
    this._setupPathfinder();

    try {
      await this._goto(new GoalXZ(pos.x + dx, pos.z + dz));
    } catch (err) {
      log.warn(this.id, `wander navigation failed: ${err.message}`);
      // Even if pathfinding fails, we tried — continue searching
      try { await this.bot.waitForTicks(10); } catch { /* disconnected */ }
    }
  }

  // ── A2A: Mission subscription from Leader ──────────────────────
  async _setupMissionSubscriber() {
    this._missionSubscriber = await this.board.createSubscriber();
    const channel = `octiv:command:${this.id}:mission`;
    await this._missionSubscriber.subscribe(channel, (message) => {
      try {
        const data = JSON.parse(message);
        this._lastMission = data;
        log.info(this.id, 'received mission from leader', { ac: data.ac, action: data.action });
        this.board.publish(`agent:${this.id}:mission:ack`, {
          author: this.id,
          ac: data.ac,
          action: data.action,
        }).catch(() => {});
      } catch (err) {
        log.error(this.id, 'mission parse error', { error: err.message });
      }
    });
    log.info(this.id, 'A2A mission subscriber active');
  }

  _getMissionAction() {
    if (this._lastMission && this._lastMission.action) {
      return this._lastMission.action;
    }
    // Fallback: local AC tracking
    if (!this.acProgress[1]) return 'collectWood';
    if (!this.acProgress[3]) return 'craftBasicTools';
    if (!this.acProgress[2]) return 'buildShelter';
    if (!this.acProgress[4]) return 'gatherAtShelter';
    return 'idle';
  }

  _getMissionParams() {
    if (this._lastMission && this._lastMission.params) {
      return this._lastMission.params;
    }
    return {};
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
      position: this.bot.entity?.position,
      velocity: this.bot.entity?.velocity,
    });
  }

  async _onDeath() {
    const deathPos = this.bot.entity?.position;
    const nearbyMobs = this.bot.entities ? Object.values(this.bot.entities)
      .filter(e => e.type === 'mob' && e.position && deathPos && e.position.distanceTo(deathPos) < 15)
      .map(e => ({ type: e.name, distance: e.position.distanceTo(deathPos).toFixed(1) })) : [];
    
    const deathReport = {
      author: this.id,
      event: 'death',
      position: deathPos ? { x: Math.floor(deathPos.x), y: Math.floor(deathPos.y), z: Math.floor(deathPos.z) } : null,
      time: Date.now(),
      timeOfDay: this.bot.time?.timeOfDay || 'unknown',
      nearbyMobs,
      metacognition: this._analyzeDeathCause(nearbyMobs)
    };

    await this.board.publish(`agent:${this.id}:death`, deathReport);
    await this.board.publish('safety:death', deathReport);
    log.error(this.id, 'died', deathReport);
  }

  _analyzeDeathCause(nearbyMobs) {
    if (nearbyMobs.length === 0) {
      return 'Unknown cause - no mobs nearby. Possibly fall damage or environmental hazard.';
    }
    const threats = nearbyMobs.map(m => m.type).join(', ');
    return `Likely killed by: ${threats}. Need better combat awareness and retreat strategy.`;
  }

  _onChat(username, message) {
    if (username === this.bot.username) return;
    log.info(this.id, `chat [${username}]: ${message}`);
  }

  // ── ReAct loop ─────────────────────────────────────────────────
  async _reactLoop() {
    while (this._running) {
      this.reactIterations++;
      try {
        await this.board.publish(`agent:${this.id}:react`, { author: this.id, iteration: this.reactIterations });
      } catch (err) {
        if (!this._running) return; // shutdown in progress
        log.error(this.id, 'react publish error', { error: err.message });
      }
      if (!this._running) return;

      try {
        const action = this._getMissionAction();
        const params = this._getMissionParams();
        switch (action) {
          case 'collectWood': await this.collectWood(params.count || 16); break;
          case 'craftBasicTools': await this.craftBasicTools(); break;
          case 'buildShelter': await this.buildShelter(); break;
          case 'gatherAtShelter': await this.gatherAtShelter(); break;
          default: await this.bot.waitForTicks(40);
        }
      } catch (err) {
        log.error(this.id, 'ReAct error', { error: err.message });
        if (this.logger) this.logger.logEvent(this.id, { type: 'error', error: err.message, iteration: this.reactIterations }).catch(e => log.error(this.id, 'log persist error', { error: e.message }));

        let shouldRetry = true;
        try {
          await this.board.logReflexion(this.id, { error: err.message, iteration: this.reactIterations });
          shouldRetry = await this._selfImprove(err);
          await this._tryLearnedSkill(err);
        } catch (recoveryErr) {
          log.error(this.id, 'recovery failed (Redis down?)', { error: recoveryErr.message });
        }

        if (!shouldRetry) {
          log.warn(this.id, 'max retries reached, skipping action');
        }
        try { await this.bot.waitForTicks(this.adaptations.waitTicks); } catch { /* bot disconnected */ }
      }
    }
  }

  async shutdown() {
    this._running = false;
    if (this._missionSubscriber) {
      try { await this._missionSubscriber.unsubscribe(); } catch {}
      try { await this._missionSubscriber.disconnect(); } catch {}
    }
    try {
      if (this.bot) this.bot.end();
    } catch (err) {
      log.error(this.id, 'shutdown bot error', { error: err.message });
    }
    await this.board.disconnect();
  }
}

module.exports = { BuilderAgent };
