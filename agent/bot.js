/**
 * @deprecated Use agent/team.js instead. This single-bot entry point is
 * superseded by the multi-agent team orchestrator. Kept for E2E smoke tests.
 */
const { OctivBot } = require('./OctivBot');
const T = require('../config/timeouts');
const { getLogger } = require('./logger');
const log = getLogger();

const BOT_CONFIG = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: 'Octiv',
  version: process.env.MC_VERSION || '1.21.11',
  checkTimeoutInterval: T.SPAWN_TIMEOUT_MS,
  auth: 'offline'
};

const BOT_OPTIONS = {
  redisUrl: process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380',
  heartbeatIntervalMs: T.HEARTBEAT_INTERVAL_MS
};

async function main() {
  log.info('bot', 'Starting Octiv Bot...');
  log.info('bot', `Target Server: ${BOT_CONFIG.host}:${BOT_CONFIG.port}`);
  log.info('bot', `Username: ${BOT_CONFIG.username}`);

  const bot = new OctivBot(BOT_CONFIG, BOT_OPTIONS);

  await bot.start();

  // Graceful Shutdown
  const cleanup = async () => {
    log.info('bot', 'shutdown signal received');
    await bot.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  log.error('bot', 'Fatal error', { error: err.message });
  process.exit(1);
});
