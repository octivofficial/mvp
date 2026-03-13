/**
 * Octivia Standalone — Telegram bot entry point for VM deployment
 *
 * Runs: Redis (Blackboard) + ReflexionEngine + TelegramBot + ObsidianAgent
 *       + WorkspaceAgent (Google Docs/Sheets — optional, requires GOOGLE credentials)
 *       + NotebookAgent (NotebookLM — optional, requires NOTEBOOKLM_* env vars)
 * Does NOT start: mineflayer bots, leader, safety, builders, Discord
 *
 * Usage:
 *   node --env-file=.env agent/octivia.js
 *   (or via docker-compose on VM)
 */
'use strict';

const { Blackboard } = require('./blackboard');
const { ReflexionEngine } = require('./ReflexionEngine');
const { createApiClients } = require('./api-clients');
const { getLogger } = require('./logger');

const log = getLogger();

/**
 * Start Octivia standalone service.
 * Accepts optional dependency overrides for testing.
 * @param {object} deps - { board, reflexion, apiClients } — injected in tests
 */
async function startOctivia(deps = {}) {
  const redisUrl = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';

  log.info('octivia', 'Starting Octivia standalone', { redis: redisUrl });

  // 1. Blackboard
  const board = deps.board || new Blackboard(redisUrl);
  if (!deps.board) await board.connect();

  // 2. LLM
  const apiClients = deps.apiClients || createApiClients();
  const reflexion = deps.reflexion || new ReflexionEngine(apiClients);
  if (!deps.reflexion) await reflexion.init();

  // 3. Telegram bot
  let telegramBot = null;
  try {
    const TelegramDevelopmentBot = require('./telegram-bot');
    telegramBot = new TelegramDevelopmentBot({
      telegramToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChannelUrl: process.env.TELEGRAM_CHANNEL_URL,
      blackboardUrl: redisUrl,
      authorizedUsers: process.env.TELEGRAM_AUTHORIZED_USERS
        ? process.env.TELEGRAM_AUTHORIZED_USERS.split(',')
        : [],
    }, board, reflexion);
    telegramBot.startPolling();
    log.info('octivia', 'Telegram bot polling');
  } catch (err) {
    log.error('octivia', 'Telegram bot failed to start', { error: err.message });
    process.exit(1);
  }

  // 4. Obsidian vault watcher (optional)
  let obsidianAgent = null;
  try {
    const ObsidianOrganizer = require('./obsidian-agent');
    obsidianAgent = new ObsidianOrganizer({
      vaultPath: process.env.OBSIDIAN_VAULT_PATH || '/app/vault',
      blackboardUrl: redisUrl,
    }, board, reflexion);
    obsidianAgent.startWatcher();
    log.info('octivia', 'Vault watcher started');
  } catch (err) {
    log.warn('octivia', 'Vault watcher unavailable', { error: err.message });
  }

  // 5. WorkspaceAgent — Google Docs/Sheets automation (optional)
  let workspaceAgent = null;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const { WorkspaceAgent } = require('./workspace-agent');
      workspaceAgent = new WorkspaceAgent({
        blackboardUrl: redisUrl,
      }, board);
      await workspaceAgent.init();
      log.info('octivia', 'WorkspaceAgent ready (Google Workspace)');
    } catch (err) {
      log.warn('octivia', 'WorkspaceAgent unavailable', { error: err.message });
    }
  } else {
    log.info('octivia', 'WorkspaceAgent skipped (no GOOGLE_APPLICATION_CREDENTIALS)');
  }

  // 6. NotebookAgent — NotebookLM research (optional)
  let notebookAgent = null;
  try {
    const { NotebookLMAgent } = require('./notebook-lm-agent');
    notebookAgent = new NotebookLMAgent({ blackboardUrl: redisUrl }, board, reflexion);
    await notebookAgent.init();
    log.info('octivia', 'NotebookAgent ready');
  } catch (err) {
    log.warn('octivia', 'NotebookAgent unavailable', { error: err.message });
  }

  log.info('octivia', 'Octivia ready. Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('octivia', 'Shutting down...');
    try {
      if (telegramBot?.client) await telegramBot.client.stopPolling();
      if (apiClients?.shutdown) await apiClients.shutdown();
      await reflexion.shutdown();
    } catch (e) { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { telegramBot, obsidianAgent, workspaceAgent, notebookAgent, board, reflexion };
}

module.exports = { startOctivia };

// Run directly
if (require.main === module) {
  startOctivia().catch(err => {
    log.error('octivia', 'Fatal error', { error: err.message });
    process.exit(1);
  });
}
