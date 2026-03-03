const { OctivBot } = require('./OctivBot');

/**
 * Octiv Bot Entry Point
 */

const BOT_CONFIG = {
  host: 'localhost',
  port: 25565,
  username: 'Octiv',
  version: '1.21.1',
  checkTimeoutInterval: 30000,
  auth: 'offline'
};

const BOT_OPTIONS = {
  redisUrl: 'redis://localhost:6380',
  heartbeatIntervalMs: 10000
};

async function main() {
  console.log('🤖 Starting Octiv Bot...');
  console.log(`   Target Server: ${BOT_CONFIG.host}:${BOT_CONFIG.port}`);
  console.log(`   Username: ${BOT_CONFIG.username}`);
  console.log('');

  const bot = new OctivBot(BOT_CONFIG, BOT_OPTIONS);

  await bot.start();

  // Graceful Shutdown
  const cleanup = async () => {
    console.log('\n🛑 Shutdown signal received...');
    await bot.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  console.error('❌ Fatal Error:', err);
  process.exit(1);
});
