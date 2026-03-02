/**
 * Octiv Team Orchestrator — 전체 에이전트 팀 시작/관리
 * Usage: node agent/team.js
 */
const { LeaderAgent } = require('./leader');
const { BuilderAgent } = require('./builder');
const { SafetyAgent } = require('./safety');
const { Blackboard } = require('./blackboard');

const TEAM_SIZE = 3; // builder 수

async function main() {
  console.log('');
  console.log('🎮 Octiv Agent Team 시작');
  console.log('═══════════════════════════════════════');
  console.log('  PaperMC: localhost:25565 (offline)');
  console.log('  Redis:   localhost:6379');
  console.log('  팀 구성: Leader + Builder x3 + Safety');
  console.log('═══════════════════════════════════════');
  console.log('');

  const board = new Blackboard();
  await board.connect();

  // Octiv 팀 초기화 상태 기록
  await board.publish('team:status', {
    status: 'initializing',
    members: ['leader', 'builder-01', 'builder-02', 'builder-03', 'safety'],
    mission: 'first-day-survival v1.3.1',
  });

  // 1. Leader 시작
  const leader = new LeaderAgent(TEAM_SIZE);
  await leader.init();

  // 2. Safety 시작
  const safety = new SafetyAgent();
  await safety.init();

  // 3. Builder 팀 시작 (순차적으로, 서버 과부하 방지)
  const builders = [];
  for (let i = 1; i <= TEAM_SIZE; i++) {
    await new Promise(r => setTimeout(r, 2000)); // 2초 간격
    const builder = new BuilderAgent({ id: `builder-0${i}` });
    await builder.init();
    builders.push(builder);
    console.log(`✅ Builder-0${i} 시작됨`);
  }

  await board.publish('team:status', {
    status: 'running',
    mission: 'first-day-survival v1.3.1',
    startedAt: new Date().toISOString(),
  });

  console.log('');
  console.log('✅ 전체 팀 실행 중. Ctrl+C로 종료.');
  console.log('');

  // 종료 처리
  process.on('SIGINT', async () => {
    console.log('\n🛑 팀 종료 중...');
    await leader.shutdown();
    await safety.shutdown();
    for (const b of builders) await b.shutdown();
    await board.disconnect();
    process.exit(0);
  });

  // 팀 상태 주기적 출력 (30초마다)
  setInterval(async () => {
    const status = await board.get('team:status');
    if (status) {
      console.log(`[Team] 상태: ${status.status} | 미션: ${status.mission}`);
    }
  }, 30000);
}

main().catch(console.error);
