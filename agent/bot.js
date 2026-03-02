/**
 * Octiv Bot — mineflayer 연결 테스트
 * Usage: node agent/bot.js
 * 
 * 서버가 실행 중이어야 합니다: ./start-server.sh
 */
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const BOT_CONFIG = {
  host: 'localhost',
  port: 25565,
  username: 'OctivBot',
  version: '1.21.1',
  auth: 'offline',
};

console.log('🤖 Octiv Bot 시작 중...');
console.log(`   서버: ${BOT_CONFIG.host}:${BOT_CONFIG.port}`);
console.log(`   이름: ${BOT_CONFIG.username}`);

const bot = mineflayer.createBot(BOT_CONFIG);

// pathfinder 플러그인 로드
bot.loadPlugin(pathfinder);

bot.once('spawn', () => {
  console.log('✅ 봇 스폰 완료!');
  console.log(`   위치: ${JSON.stringify(bot.entity.position)}`);
  console.log(`   체력: ${bot.health} / 20`);
  console.log(`   배고픔: ${bot.food} / 20`);

  // Blackboard에 스폰 이벤트 기록 (Redis 연결 시 활성화)
  // publishToBlackboard('bot:spawn', { username: BOT_CONFIG.username, position: bot.entity.position });

  bot.chat('안녕하세요! Octiv 봇이 준비되었습니다. 🎮');
});

bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  console.log(`💬 [${username}]: ${message}`);

  // 간단한 명령 처리
  if (message === '!status') {
    bot.chat(`상태: 체력 ${Math.floor(bot.health)}/20, 배고픔 ${Math.floor(bot.food)}/20`);
  }
  if (message === '!pos') {
    const pos = bot.entity.position;
    bot.chat(`위치: X=${Math.floor(pos.x)}, Y=${Math.floor(pos.y)}, Z=${Math.floor(pos.z)}`);
  }
});

bot.on('health', () => {
  // 체력 10 이하 경고 (AC-8 fall death 감지 준비)
  if (bot.health <= 10) {
    console.warn(`⚠️  체력 경고: ${bot.health}/20`);
  }
});

bot.on('error', (err) => {
  console.error('❌ 봇 에러:', err.message);
});

bot.on('end', () => {
  console.log('🔌 봇 연결 종료');
});
