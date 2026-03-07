/**
 * Octiv Team Orchestrator — start and manage the full agent team
 * Usage: node agent/team.js
 */
const { LeaderAgent } = require('./leader');
const { BuilderAgent } = require('./builder');
const { SafetyAgent } = require('./safety');
const { Blackboard } = require('./blackboard');
const { MemoryLogger } = require('./memory-logger');
const { SkillPipeline } = require('./skill-pipeline');
const { ReflexionEngine } = require('./ReflexionEngine');
const { ExplorerAgent } = require('./roles/ExplorerAgent');
const { MinerAgent } = require('./roles/MinerAgent');
const { FarmerAgent } = require('./roles/FarmerAgent');
const { createApiClients } = require('./api-clients');
const { SkillZettelkasten } = require('./skill-zettelkasten');
const { RuminationEngine } = require('./rumination-engine');
const { GoTReasoner } = require('./got-reasoner');
const { ZettelkastenHooks } = require('./zettelkasten-hooks');
const { getLogger } = require('./logger');
const T = require('../config/timeouts');

const log = getLogger();
const TEAM_SIZE = 3; // number of builder agents

/**
 * Handle emergency event from skills:emergency subscription.
 * Extracted from main() for testability.
 * @param {object} data - parsed emergency event
 * @param {object} deps - { pipeline, leader, logger, lastEmergency }
 */
async function handleEmergencyEvent(data, deps) {
  const { pipeline, leader, logger, lastEmergency } = deps;
  logger.logEvent('team', { type: 'emergency', ...data }).catch(e => log.error('team', 'log persist error', { error: e.message }));
  log.warn('team', `Emergency: ${data.failureType || data.newSkill || 'unknown'}`);

  // Increment leader failure counter on safety threats (deduped)
  if (data.failureType) {
    if (shouldProcessEmergency(lastEmergency, data.failureType)) {
      leader.consecutiveTeamFailures++;
      await leader.checkReflexionTrigger();
    }
  }

  // If safety triggered skill creation, attempt to generate a skill
  if (data.triggerSkillCreation && data.failureType && pipeline) {
    const result = await pipeline.generateFromFailure({
      error: data.failureType,
      errorType: data.failureType,
      agentId: data.agentId || 'unknown',
    });
    if (result.success) {
      await leader.injectLearnedSkill(result.skill);
      logger.logEvent('team', { type: 'skill_created', skill: result.skill }).catch(e => log.error('team', 'log persist error', { error: e.message }));
    }
  }
}

/**
 * Create explorer execution loop — piggyback on builder-01's position via Blackboard.
 * Extracted from main() for testability.
 * @param {object} board - Blackboard instance
 * @param {object} explorer - ExplorerAgent instance
 * @param {number} intervalMs - poll interval
 * @returns {NodeJS.Timeout} interval ID for cleanup
 */
function createExplorerLoop(board, explorer, intervalMs = T.EXPLORER_LOOP_INTERVAL_MS) {
  let executing = false;
  return setInterval(async () => {
    if (executing) return;
    executing = true;
    try {
      const status = await board.get('agent:builder-01:status');
      if (status?.position) {
        const mockBot = { entity: { position: status.position }, blockAt: () => null };
        await explorer.execute(mockBot);
      }
    } catch (err) {
      log.error('explorer', 'loop error', { error: err.message });
    } finally {
      executing = false;
    }
  }, intervalMs);
}

/**
 * Create role execution loop — piggyback on builder-01's position via Blackboard.
 * Generic loop for Miner, Farmer, and other BaseRole-based agents.
 * @param {object} board - Blackboard instance
 * @param {object} agent - BaseRole instance (MinerAgent, FarmerAgent)
 * @param {number} intervalMs - poll interval
 * @returns {NodeJS.Timeout} interval ID for cleanup
 */
function createRoleLoop(board, agent, intervalMs) {
  let executing = false;
  return setInterval(async () => {
    if (executing) return;
    executing = true;
    try {
      const status = await board.get('agent:builder-01:status');
      if (status?.position) {
        const mockBot = {
          entity: { position: status.position },
          blockAt: () => null,
          findBlock: () => null,
          findBlocks: () => [],
          inventory: { items: () => [] },
          equip: async () => {},
          dig: async () => {},
          placeBlock: async () => {},
          pathfinder: { setMovements: () => {}, goto: async () => {}, stop: () => {} },
        };
        await agent.execute(mockBot);
      }
    } catch (err) {
      log.error(agent.id, 'loop error', { error: err.message });
    } finally {
      executing = false;
    }
  }, intervalMs);
}

/**
 * Graceful shutdown — stop all agents and resources.
 * Extracted from main() for testability.
 * @param {object} agents - { leader, safety, explorer, miner, farmer, builders }
 * @param {object} resources - { explorerInterval, emergencySubscriber, zkHooks, got, rumination, zettelkasten, pipeline, reflexion, board, logger }
 */
async function gracefulShutdown(agents, resources) {
  log.info('team', 'Team shutting down...');

  clearInterval(resources.explorerInterval);
  clearInterval(resources.minerInterval);
  clearInterval(resources.farmerInterval);
  resources.logger.logEvent('team', { type: 'shutdown' }).catch(e => log.error('team', 'log persist error', { error: e.message }));

  // Parallel agent shutdown — independent agents don't need serial ordering
  const agentResults = await Promise.allSettled([
    agents.leader.shutdown(),
    agents.safety.shutdown(),
    agents.explorer.shutdown(),
    agents.miner.shutdown(),
    agents.farmer.shutdown(),
    ...agents.builders.map(b => b.shutdown()),
  ]);
  for (const r of agentResults) {
    if (r.status === 'rejected') log.error('team', 'agent shutdown error', { error: r.reason?.message });
  }

  // Sequential resource cleanup — subscriber must unsubscribe before disconnect, board last
  try { await resources.emergencySubscriber.unsubscribe(); } catch (err) { log.error('team', 'subscriber cleanup error', { error: err.message }); }
  try { await resources.emergencySubscriber.disconnect(); } catch (err) { log.error('team', 'subscriber disconnect error', { error: err.message }); }

  // Only shutdown learning resources that were successfully initialized
  const learningResources = [
    resources.zkHooks, resources.got, resources.rumination,
    resources.zettelkasten, resources.pipeline,
  ].filter(Boolean);
  if (learningResources.length > 0) {
    const resourceResults = await Promise.allSettled(
      learningResources.map(r => r.shutdown()),
    );
    for (const r of resourceResults) {
      if (r.status === 'rejected') log.error('team', 'resource shutdown error', { error: r.reason?.message });
    }
  }
  if (resources.reflexion) {
    try { await resources.reflexion.shutdown(); } catch (err) { log.error('team', 'reflexion shutdown error', { error: err.message }); }
  }

  // Shutdown API clients after all consumers — stops LM Studio health monitor timer
  if (resources.apiClients?.shutdown) {
    try { resources.apiClients.shutdown(); } catch (err) { log.error('team', 'apiClients shutdown error', { error: err.message }); }
  }

  try { await resources.board.disconnect(); } catch (err) { log.error('team', 'board disconnect error', { error: err.message }); }
}

function shouldProcessEmergency(state, failureType, dedupMs = T.EMERGENCY_DEDUP_MS) {
  const now = Date.now();
  if (failureType === state.type && now - state.time < dedupMs) return false;
  state.type = failureType;
  state.time = now;
  return true;
}

function monitorGathering(board, teamSize, intervalMs = T.GATHERING_POLL_INTERVAL_MS) {
  const checkInterval = setInterval(async () => {
    try {
      let arrivedCount = 0;
      for (let i = 1; i <= teamSize; i++) {
        const ac = await board.getACProgress(`builder-0${i}`);
        if (ac && ac['AC-4']) {
          const parsed = JSON.parse(ac['AC-4']);
          if (parsed.status === 'done') arrivedCount++;
        }
      }
      if (arrivedCount >= teamSize) {
        clearInterval(checkInterval);
        await board.publish('team:ac4', {
          author: 'team',
          status: 'done',
          message: `All ${teamSize} builders gathered at shelter`,
        });
        log.info('team', `AC-4 complete: all ${teamSize} builders at shelter`);
      }
    } catch (err) {
      // Ignore polling errors
    }
  }, intervalMs);
  return checkInterval;
}

/**
 * Remote Control listener — responds to RC commands published by discord-bot
 * Supports: status, agents, ac, log, test
 */
async function setupRemoteControl(board, agents) {
  const rcSubscriber = await board.createSubscriber();
  const rcCommands = ['status', 'agents', 'ac', 'log', 'test'];

  for (const subcmd of rcCommands) {
    await rcSubscriber.subscribe(`octiv:rc:cmd:${subcmd}`, async (message) => {
      try {
        const request = JSON.parse(message);
        const requestId = request.requestId;
        if (!requestId) return;

        let data;
        switch (subcmd) {
          case 'status': {
            const teamStatus = await board.get('team:status');
            data = {
              status: teamStatus?.status || 'unknown',
              mission: teamStatus?.mission || 'unknown',
              uptime: teamStatus?.startedAt
                ? `${Math.round((Date.now() - new Date(teamStatus.startedAt).getTime()) / 1000)}s`
                : 'unknown',
              builders: agents.builders.length,
            };
            break;
          }
          case 'agents': {
            const agentList = [
              { id: agents.leader.id, role: 'leader', mode: agents.leader.mode },
              ...agents.builders.map((b, i) => ({ id: `builder-0${i + 1}`, role: 'builder' })),
              { id: 'safety-01', role: 'safety' },
              { id: 'explorer-01', role: 'explorer' },
              ...(agents.miner ? [{ id: agents.miner.id, role: 'miner' }] : []),
              ...(agents.farmer ? [{ id: agents.farmer.id, role: 'farmer' }] : []),
            ];
            data = agentList;
            break;
          }
          case 'ac': {
            const matrix = {};
            for (let i = 1; i <= agents.builders.length; i++) {
              const progress = await board.getACProgress(`builder-0${i}`);
              const parsed = {};
              for (const [k, v] of Object.entries(progress)) {
                try { parsed[k] = JSON.parse(v).status; } catch { parsed[k] = v; }
              }
              matrix[`builder-0${i}`] = parsed;
            }
            data = matrix;
            break;
          }
          case 'log': {
            const recent = await board.get('team:status');
            data = `Team: ${recent?.status || 'unknown'} | Mission: ${recent?.mission || 'unknown'}`;
            break;
          }
          case 'test': {
            data = 'RC connection OK. Team is responsive.';
            break;
          }
        }

        // Publish response back via main board client
        const responsePayload = JSON.stringify({
          ts: Date.now(),
          requestId,
          data,
        });
        await board.client.publish(`octiv:${requestId}`, responsePayload);
      } catch (err) {
        log.error('team', `RC handler error for ${subcmd}`, { error: err.message });
      }
    });
  }

  log.info('team', 'Remote Control listener active', { commands: rcCommands });
  return rcSubscriber;
}

async function main() {
  const redisDisplay = (process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380').replace(/:\/\/[^@]*@/, '://***@');
  log.info('team', 'Octiv Agent Team starting', {
    papermc: `${process.env.MC_HOST || 'localhost'}:${process.env.MC_PORT || 25565}`,
    redis: redisDisplay,
    composition: 'Leader + Builder x3 + Safety + Explorer + Miner + Farmer',
  });

  const board = new Blackboard();
  try {
    await board.connect();
  } catch (err) {
    log.error('team', 'FATAL: Redis unavailable', { error: err.message });
    process.exit(1);
  }

  // AC-7: Persistent disk logging — shared across all agents
  const logger = new MemoryLogger();

  // Task A: Create API clients from environment (Anthropic primary, Groq fallback)
  const apiClients = createApiClients();

  // Learning pipeline: ReflexionEngine → SkillPipeline → Zettelkasten
  // Wrapped in try/catch — bots run without LLM skill generation if this fails
  let reflexion = null, pipeline = null;
  let zettelkasten = null, rumination = null, got = null, zkHooks = null;

  try {
    reflexion = new ReflexionEngine(apiClients);
    await reflexion.init();
    pipeline = new SkillPipeline(reflexion);
    await pipeline.init();

    zettelkasten = new SkillZettelkasten({ logger });
    await zettelkasten.init();
    rumination = new RuminationEngine(zettelkasten, { logger });
    await rumination.init();
    got = new GoTReasoner(zettelkasten, { logger });
    await got.init();
    zkHooks = new ZettelkastenHooks(zettelkasten, rumination, got, { logger });
    await zkHooks.init();

    zkHooks.wireToSkillPipeline(pipeline);
    log.info('team', 'Learning pipeline initialized');
  } catch (err) {
    log.warn('team', 'Learning pipeline unavailable — bots will run without skill generation', { error: err.message });
  }

  // Record Octiv team initialization state
  await board.publish('team:status', {
    author: 'team',
    status: 'initializing',
    members: ['leader', 'builder-01', 'builder-02', 'builder-03', 'safety', 'explorer', 'miner-01', 'farmer-01'],
    mission: 'first-day-survival v1.3.1',
  });

  // 1. Start Leader (with learning pipeline)
  const leader = new LeaderAgent(TEAM_SIZE);
  leader.setLogger(logger);
  leader.setSkillPipeline(pipeline); // accepts null
  await leader.init();
  if (zkHooks) zkHooks.wireToLeader(leader);

  // 2. Start Safety (with logger)
  const safety = new SafetyAgent();
  safety.setLogger(logger);
  await safety.init();

  // 3. Start Builder team (sequentially to prevent server overload)
  const builders = [];
  for (let i = 1; i <= TEAM_SIZE; i++) {
    await new Promise(r => setTimeout(r, T.BUILDER_SPAWN_INTERVAL_MS));
    const builder = new BuilderAgent({ id: `builder-0${i}` });
    builder.setLogger(logger);
    builder.setSkillPipeline(pipeline); // accepts null — bots work without skills
    try {
      await builder.init();
      if (zkHooks) zkHooks.wireToBuilder(builder);
      builders.push(builder);
      log.info('team', `Builder-0${i} started`);
    } catch (err) {
      log.error('team', `Builder-0${i} failed to start`, { error: err.message });
    }
  }

  if (builders.length === 0) {
    log.error('team', 'FATAL: No builders started. Exiting.');
    process.exit(1);
  }

  // 4. Start Explorer (world scout — uses Blackboard, not direct mineflayer)
  const explorer = new ExplorerAgent({ id: 'explorer-01', maxRadius: 200 });
  await explorer.init();
  log.info('team', 'Explorer-01 started');

  // 5. Start Miner + Farmer (specialized roles — Phase 7.2)
  const miner = new MinerAgent({ id: 'miner-01' });
  await miner.init();
  log.info('team', 'Miner-01 started');

  const farmer = new FarmerAgent({ id: 'farmer-01' });
  await farmer.init();
  log.info('team', 'Farmer-01 started');

  // Execution loops — piggyback on builder-01's position via Blackboard
  const explorerInterval = createExplorerLoop(board, explorer);
  const minerInterval = createRoleLoop(board, miner, T.MINER_LOOP_INTERVAL_MS);
  const farmerInterval = createRoleLoop(board, farmer, T.FARMER_LOOP_INTERVAL_MS);
  log.info('team', 'Role loops started (explorer, miner, farmer)');

  // Subscribe to skills:emergency — handle safety alerts and skill pipeline events
  const emergencySubscriber = await board.createSubscriber();
  let lastEmergency = { type: null, time: 0 };
  emergencySubscriber.subscribe('octiv:skills:emergency', async (message) => {
    try {
      const data = JSON.parse(message);
      await handleEmergencyEvent(data, { pipeline, leader, logger, lastEmergency });
    } catch (err) {
      log.error('team', 'emergency handler error', { error: err.message });
    }
  });

  await board.publish('team:status', {
    author: 'team',
    status: 'running',
    mission: 'first-day-survival v1.3.1',
    startedAt: new Date().toISOString(),
  });

  logger.logEvent('team', { type: 'started', members: TEAM_SIZE + 2 }).catch(e => log.error('team', 'log persist error', { error: e.message }));

  log.info('team', 'Full team running. Press Ctrl+C to stop.');

  // Monitor AC-4: all builders gathered at shelter
  monitorGathering(board, TEAM_SIZE);

  // Graceful shutdown handler
  process.on('SIGINT', async () => {
    const forceExit = setTimeout(() => {
      log.error('team', 'Shutdown timeout (10s), forcing exit');
      process.exit(1);
    }, T.SHUTDOWN_TIMEOUT_MS);

    await gracefulShutdown(
      { leader, safety, explorer, miner, farmer, builders },
      { explorerInterval, minerInterval, farmerInterval, emergencySubscriber, zkHooks, got, rumination, zettelkasten, pipeline, reflexion, board, logger, apiClients },
    );

    clearTimeout(forceExit);
    process.exit(0);
  });

  // Remote Control: listen for RC commands from Discord bot
  await setupRemoteControl(board, { leader, safety, builders, explorer, miner, farmer });

  // Log team status periodically (every 30s)
  setInterval(async () => {
    const status = await board.get('team:status');
    if (status) {
      log.info('team', `status: ${status.status} | mission: ${status.mission}`);
    }
  }, T.STATUS_LOG_INTERVAL_MS);
}

if (require.main === module) {
  main().catch(err => log.error('team', 'Fatal error', { error: err.message }));
}

module.exports = {
  monitorGathering, main, shouldProcessEmergency, setupRemoteControl,
  handleEmergencyEvent, createExplorerLoop, createRoleLoop, gracefulShutdown,
};
