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

const TEAM_SIZE = 3; // number of builder agents

async function monitorGathering(board, teamSize) {
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
        console.log(`🏠 AC-4 complete: all ${teamSize} builders at shelter`);
      }
    } catch (err) {
      // Ignore polling errors
    }
  }, 5000);
}

async function main() {
  console.log('');
  console.log('🎮 Octiv Agent Team starting');
  console.log('═══════════════════════════════════════');
  console.log('  PaperMC: localhost:25565 (offline)');
  console.log('  Redis:   localhost:6380');
  console.log('  Team:    Leader + Builder x3 + Safety + Explorer');
  console.log('═══════════════════════════════════════');
  console.log('');

  const board = new Blackboard();
  await board.connect();

  // AC-7: Persistent disk logging — shared across all agents
  const logger = new MemoryLogger();

  // Learning pipeline: ReflexionEngine → SkillPipeline → Leader
  const reflexion = new ReflexionEngine();
  await reflexion.init();
  const pipeline = new SkillPipeline(reflexion);
  await pipeline.init();

  // Record Octiv team initialization state
  await board.publish('team:status', {
    author: 'team',
    status: 'initializing',
    members: ['leader', 'builder-01', 'builder-02', 'builder-03', 'safety', 'explorer'],
    mission: 'first-day-survival v1.3.1',
  });

  // 1. Start Leader (with learning pipeline)
  const leader = new LeaderAgent(TEAM_SIZE);
  leader.setLogger(logger);
  leader.setSkillPipeline(pipeline);
  await leader.init();

  // 2. Start Safety (with logger)
  const safety = new SafetyAgent();
  safety.setLogger(logger);
  await safety.init();

  // 3. Start Builder team (sequentially to prevent server overload)
  const builders = [];
  for (let i = 1; i <= TEAM_SIZE; i++) {
    await new Promise(r => setTimeout(r, 2000)); // 2s interval
    const builder = new BuilderAgent({ id: `builder-0${i}` });
    builder.setLogger(logger);
    await builder.init();
    builders.push(builder);
    console.log(`✅ Builder-0${i} started`);
  }

  // 4. Start Explorer (world scout — uses Blackboard, not direct mineflayer)
  const explorer = new ExplorerAgent({ id: 'explorer-01', maxRadius: 200 });
  await explorer.init();
  console.log('✅ Explorer-01 started');

  // Subscribe to skills:emergency — handle safety alerts and skill pipeline events
  const emergencySubscriber = await board.createSubscriber();
  emergencySubscriber.subscribe('octiv:skills:emergency', async (message) => {
    try {
      const data = JSON.parse(message);
      logger.logEvent('team', { type: 'emergency', ...data });
      console.warn(`[Team] ⚠️  Emergency: ${data.failureType || data.newSkill || 'unknown'}`);

      // If safety triggered skill creation, attempt to generate a skill
      if (data.triggerSkillCreation && data.failureType) {
        const result = await pipeline.generateFromFailure({
          error: data.failureType,
          errorType: data.failureType,
          agentId: data.agentId || 'unknown',
        });
        if (result.success) {
          await leader.injectLearnedSkill(result.skill);
          logger.logEvent('team', { type: 'skill_created', skill: result.skill });
        }
      }
    } catch (err) {
      console.error('[Team] emergency handler error:', err.message);
    }
  });

  await board.publish('team:status', {
    author: 'team',
    status: 'running',
    mission: 'first-day-survival v1.3.1',
    startedAt: new Date().toISOString(),
  });

  logger.logEvent('team', { type: 'started', members: TEAM_SIZE + 2 });

  console.log('');
  console.log('✅ Full team running. Press Ctrl+C to stop.');
  console.log('');

  // Monitor AC-4: all builders gathered at shelter
  monitorGathering(board, TEAM_SIZE);

  // Graceful shutdown handler
  process.on('SIGINT', async () => {
    console.log('\n🛑 Team shutting down...');
    logger.logEvent('team', { type: 'shutdown' });
    await leader.shutdown();
    await safety.shutdown();
    await explorer.shutdown();
    for (const b of builders) await b.shutdown();
    await emergencySubscriber.unsubscribe();
    await emergencySubscriber.disconnect();
    await pipeline.shutdown();
    await reflexion.shutdown();
    await board.disconnect();
    process.exit(0);
  });

  // Log team status periodically (every 30s)
  setInterval(async () => {
    const status = await board.get('team:status');
    if (status) {
      console.log(`[Team] status: ${status.status} | mission: ${status.mission}`);
    }
  }, 30000);
}

main().catch(console.error);
