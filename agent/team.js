/**
 * Octiv Team Orchestrator — start and manage the full agent team
 * Usage: node agent/team.js
 */
const { LeaderAgent } = require('./leader');
const { BuilderAgent } = require('./builder');
const { SafetyAgent } = require('./safety');
const { Blackboard } = require('./blackboard');

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
  console.log('  Team:    Leader + Builder x3 + Safety');
  console.log('═══════════════════════════════════════');
  console.log('');

  const board = new Blackboard();
  await board.connect();

  // Record Octiv team initialization state
  await board.publish('team:status', {
    author: 'team',
    status: 'initializing',
    members: ['leader', 'builder-01', 'builder-02', 'builder-03', 'safety'],
    mission: 'first-day-survival v1.3.1',
  });

  // 1. Start Leader
  const leader = new LeaderAgent(TEAM_SIZE);
  await leader.init();

  // 2. Start Safety
  const safety = new SafetyAgent();
  await safety.init();

  // 3. Start Builder team (sequentially to prevent server overload)
  const builders = [];
  for (let i = 1; i <= TEAM_SIZE; i++) {
    await new Promise(r => setTimeout(r, 2000)); // 2s interval
    const builder = new BuilderAgent({ id: `builder-0${i}` });
    await builder.init();
    builders.push(builder);
    console.log(`✅ Builder-0${i} started`);
  }

  await board.publish('team:status', {
    author: 'team',
    status: 'running',
    mission: 'first-day-survival v1.3.1',
    startedAt: new Date().toISOString(),
  });

  console.log('');
  console.log('✅ Full team running. Press Ctrl+C to stop.');
  console.log('');

  // Monitor AC-4: all builders gathered at shelter
  monitorGathering(board, TEAM_SIZE);

  // Graceful shutdown handler
  process.on('SIGINT', async () => {
    console.log('\n🛑 Team shutting down...');
    await leader.shutdown();
    await safety.shutdown();
    for (const b of builders) await b.shutdown();
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
